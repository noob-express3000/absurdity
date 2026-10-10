import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function runScenario(script: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { getDatabase } from './lib/database.ts';
    import { installTursoHttp } from './tests/helpers/turso-http.mjs';
    process.env.TURSO_DATABASE_URL = 'https://database.turso.test';
    process.env.TURSO_AUTH_TOKEN = 'test';
    const http = installTursoHttp();
    try { const db = await getDatabase(); ${script} } finally { http.restore(); }
  `], { encoding: 'utf8', timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
}

test('Turso reads and writes survive expired idle streams and retain bound values', () => {
  runScenario(`
    await db.execute('CREATE TABLE qa_values (id INTEGER PRIMARY KEY, label TEXT, score REAL)');
    await db.execute('INSERT INTO qa_values VALUES (?, ?, ?)', [1, 'cat’s parade', 2.5]);
    assert.deepEqual(await db.query('SELECT * FROM qa_values WHERE id = ?', [1]), [{ id: 1, label: 'cat’s parade', score: 2.5 }]);
    http.expire();
    assert.deepEqual(await db.query('SELECT label FROM qa_values WHERE id = ?', [1]), [{ label: 'cat’s parade' }]);
    http.expire();
    assert.equal(await db.execute('UPDATE qa_values SET label = ? WHERE id = ?', [null, 1]), 1);
    http.expire();
    assert.deepEqual(await db.query('INSERT INTO qa_values VALUES (?, ?, ?) RETURNING id', [2, 'goat', 3]), [{ id: 2 }]);
    http.expire();
    await db.batch([{ sql: 'UPDATE qa_values SET score = ? WHERE id = ?', params: [4, 2] }], true);
    assert.deepEqual(await db.query('SELECT label, score FROM qa_values WHERE id = ?', [1]), [{ label: null, score: 2.5 }]);
    assert.equal(http.activeStreams(), 0);
    assert.ok(http.requests.filter(request => !request.baton).every(request => request.url.startsWith('https://database.turso.test/')));
    assert.ok(!http.requests.some(request => request.requests?.some(item => item.type === 'describe')));
  `);
});

test('fresh Turso streams enforce foreign keys and roll back atomic writes without retries', () => {
  runScenario(`
    await db.batch([
      { sql: 'CREATE TABLE qa_parents (id TEXT PRIMARY KEY)' },
      { sql: 'CREATE TABLE qa_children (id TEXT PRIMARY KEY, parent TEXT REFERENCES qa_parents(id) ON DELETE CASCADE)' },
    ], true);
    await assert.rejects(db.batch([
      { sql: 'INSERT INTO qa_parents VALUES (?)', params: ['rolled-back'] },
      { sql: 'INSERT INTO qa_children VALUES (?, ?)', params: ['bad', 'missing'] },
    ], true), /FOREIGN KEY/);
    assert.deepEqual(await db.query('SELECT * FROM qa_parents'), []);
    assert.equal(http.executed.filter(item => item.sql === 'INSERT INTO qa_parents VALUES (?)').length, 1);
    assert.ok(http.executed.some(item => item.sql === 'ROLLBACK'));
    await assert.rejects(db.execute('INSERT INTO qa_children VALUES (?, ?)', ['bad', 'missing']), /FOREIGN KEY/);
    await assert.rejects(db.query('INSERT INTO qa_children VALUES (?, ?) RETURNING id', ['bad', 'missing']), /FOREIGN KEY/);
    await db.batch([
      { sql: 'INSERT INTO qa_parents VALUES (?)', params: ['saved'] },
      { sql: 'INSERT INTO qa_children VALUES (?, ?)', params: ['child', 'saved'] },
    ], true);
    http.expire();
    await db.execute('DELETE FROM qa_parents WHERE id = ?', ['saved']);
    assert.deepEqual(await db.query('SELECT * FROM qa_children'), []);
    assert.equal(http.activeStreams(), 0);
  `);
});

test('Turso cleanup failures preserve committed writes and original SQL errors', () => {
  runScenario(`
    await db.execute('CREATE TABLE qa_unique (id INTEGER PRIMARY KEY)');
    http.failCleanup();
    assert.equal(await db.execute('INSERT INTO qa_unique VALUES (?)', [1]), 1);
    await assert.rejects(db.execute('INSERT INTO qa_unique VALUES (?)', [1]), /UNIQUE constraint/);
    assert.deepEqual(await db.query('SELECT * FROM qa_unique'), [{ id: 1 }]);
    assert.equal(http.executed.filter(item => item.sql === 'INSERT INTO qa_unique VALUES (?)').length, 2);
    assert.equal(http.activeStreams(), 0);
  `);
});
