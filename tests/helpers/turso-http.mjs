import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the installed Turso driver over its real HTTP protocol. Each baton
// owns a SQLite connection, including transactions and connection-local PRAGMAs.
export function installTursoHttp() {
  const directory = mkdtempSync(join(tmpdir(), 'absurdity-turso-'));
  const streams = new Map();
  const requests = [];
  const executed = [];
  let nextBaton = 0;
  let failClose = false;
  const originalFetch = globalThis.fetch;
  const encode = value => value === null ? { type: 'null' }
    : typeof value === 'number' ? { type: Number.isInteger(value) ? 'integer' : 'float', value: Number.isInteger(value) ? String(value) : value }
    : { type: 'text', value: String(value) };
  const decode = value => value.type === 'null' ? null
    : ['integer', 'float'].includes(value.type) ? Number(value.value) : value.value;
  const conditionMet = (condition, outcomes, stream) => !condition || (
    condition.type === 'ok' ? outcomes[condition.step] === true
      : condition.type === 'not' ? !conditionMet(condition.cond, outcomes, stream)
      : condition.type === 'and' ? condition.conds.every(item => conditionMet(item, outcomes, stream))
      : condition.type === 'is_autocommit' ? !stream.transaction : false
  );

  globalThis.fetch = async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url: String(url), ...request });
    if (request.baton && !streams.has(request.baton)) return new Response('', { status: 404 });
    const baton = request.baton || 'stream-' + ++nextBaton;
    if (!streams.has(baton)) streams.set(baton, { db: new DatabaseSync(join(directory, 'archive.db')), transaction: false });
    const stream = streams.get(baton);

    if (String(url).endsWith('/v3/pipeline')) {
      const results = request.requests.map(item => {
        if (item.type === 'close') {
          stream.db.close();
          streams.delete(baton);
          return { type: 'ok', response: { type: 'close' } };
        }
        if (item.type === 'describe') return { type: 'ok', response: { type: 'describe', result: {
          params: [], cols: stream.db.prepare(item.sql).columns().map(column => ({ name: column.name, decltype: column.type || '' })),
          is_explain: false, is_readonly: true,
        } } };
        return { type: 'ok', response: { type: 'get_autocommit', is_autocommit: !stream.transaction } };
      });
      if (failClose && request.requests.some(item => item.type === 'close')) return new Response('', { status: 503 });
      return Response.json({ baton: streams.has(baton) ? baton : null, base_url: 'https://node.turso.test', results });
    }

    const entries = [{ baton, base_url: 'https://node.turso.test' }];
    const outcomes = [];
    for (const [step, item] of request.batch.steps.entries()) {
      if (!conditionMet(item.condition, outcomes, stream)) continue;
      try {
        const { sql, args = [] } = item.stmt;
        executed.push({ baton, sql, args });
        const statement = stream.db.prepare(sql);
        const columns = statement.columns().map(column => ({ name: column.name, decltype: column.type || '' }));
        entries.push({ type: 'step_begin', step, cols: columns });
        let changes = 0;
        if (columns.length) {
          for (const row of statement.all(...args.map(decode))) entries.push({ type: 'row', row: columns.map(column => encode(row[column.name])) });
        } else changes = Number(statement.run(...args.map(decode)).changes);
        if (/^BEGIN\b/i.test(sql)) stream.transaction = true;
        if (/^(COMMIT|ROLLBACK)\b/i.test(sql)) stream.transaction = false;
        entries.push({ type: 'step_end', affected_row_count: changes });
        outcomes[step] = true;
      } catch (error) {
        entries.push({ type: 'step_error', step, error: { message: error.message, code: 'SQLITE_CONSTRAINT' } });
        outcomes[step] = false;
      }
    }
    return new Response(entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  };

  return {
    requests, executed,
    expire() { for (const stream of streams.values()) stream.db.close(); streams.clear(); },
    failCleanup() { failClose = true; },
    activeStreams() { return streams.size; },
    restore() { globalThis.fetch = originalFetch; this.expire(); rmSync(directory, { recursive: true, force: true }); },
  };
}
