import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { getDatabase } from '../lib/database';
import { runDiscovery } from '../lib/research';
import { runDailyResearch } from '../lib/pipeline';
import { PersistentStoryRepository } from '../lib/repository';
import { GET as healthGet } from '../app/api/health/route';

before(() => {
  process.env.ABSURDITY_SQLITE_PATH = ':memory:';
  for (const key of ['ABSURDITY_MODE', 'GROQ_API_KEY', 'EXA_API_KEY', 'TAVILY_API_KEY', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'ABSURDITY_REQUIRE_TURSO', 'RENDER']) delete process.env[key];
});
beforeEach(async () => {
  const db = await getDatabase();
  await db.execute('DELETE FROM stories');
  await db.execute('DELETE FROM research_lease');
  await db.execute('DELETE FROM research_runs');
});

test('stale Exa hits cannot consume the publisher cap before fresh RSS and Exa hits', async () => {
  const now = new Date();
  const result = await runDiscovery({ now,
    searchWeb: async () => [
      ...Array.from({ length: 3 }, (_, i) => ({ title: 'Old unusual story ' + i, url: 'https://news.example/old-' + i, publishedDate: '2020-01-01T00:00:00Z' })),
      { title: 'Fresh Exa event', url: 'https://news.example/fresh-exa', publishedDate: now.toISOString() },
    ],
    parseFeed: async url => ({ items: url.includes('upi') ? [{ title: 'Fresh RSS event', link: 'https://news.example/fresh-rss', isoDate: now.toISOString() }] : [] }),
  });
  assert.deepEqual(result.candidates.map(candidate => candidate.url).sort(), ['https://news.example/fresh-exa', 'https://news.example/fresh-rss']);
});

test('repeat discoveries skip selected events before spending the candidate and provider budgets', async () => {
  const originalFetch = globalThis.fetch;
  const oldLimit = process.env.RESEARCH_MAX_CANDIDATES;
  const candidate = { title: 'Unusual robot delivers bread to a zoo', url: 'https://news.example/zoo', publisher: 'News', publishedAt: new Date().toISOString(), localScore: 90, origin: 'exa' as const };
  let modelCalls = 0;
  let articleCalls = 0;
  try {
    process.env.GROQ_API_KEY = 'test';
    process.env.RESEARCH_MAX_CANDIDATES = '1';
    globalThis.fetch = async () => { modelCalls++; return Response.json({ output_text: JSON.stringify({ selected: true, confidence: 'high', summary: 'A reported event.', detailedSummary: 'The report describes the event.', corroboratingUrls: [] }) }); };
    const discover = async (candidates: typeof candidate[]) => ({ scanned: candidates.length, unusualCandidates: candidates.length, candidates, failures: [], note: 'QA' });
    const loadArticle = async () => { articleCalls++; throw new Error('Excerpt only'); };
    const first = await runDailyResearch({ discover: () => discover([candidate]), loadArticle });
    assert.ok('selected' in first && first.selected === 1);
    const originalStory = (await new PersistentStoryRepository().searchStories(''))[0];
    // Syndication changes the URL and candidate ranking, but describes the saved event.
    const next = { ...candidate, title: 'Neighbours build a giant paper hat', url: 'https://other.example/hat', localScore: 20 };
    const second = await runDailyResearch({ discover: () => discover([{ ...candidate, url: 'https://syndicated.example/copy' }, next]), loadArticle });
    assert.ok('selected' in second && second.selected === 1);
    assert.equal(modelCalls, 2);
    assert.equal(articleCalls, 2);
    assert.deepEqual(await new PersistentStoryRepository().getStory(originalStory.id), originalStory);
    assert.equal((await new PersistentStoryRepository().searchStories('')).length, 2);
    assert.equal((await new PersistentStoryRepository().searchStories('hat')).length, 1);
    // Tracking parameters and a changed headline must still match the saved source URL.
    const third = await runDailyResearch({ discover: () => discover([{ ...candidate, title: 'Delivery robot update', url: candidate.url + '?utm_source=repeat' }]), loadArticle });
    assert.ok('selected' in third && third.candidates === 0);
    assert.equal(modelCalls, 2);
    // An unrelated occurrence months later may reuse a headline, so title-only
    // deduplication is bounded to the research window; source URLs remain stable.
    const db = await getDatabase();
    await db.execute('UPDATE stories SET publication_date = ? WHERE id = ?', ['2020-01-01T00:00:00.000Z', originalStory.id]);
    const fourth = await runDailyResearch({ discover: () => discover([{ ...candidate, url: 'https://news.example/new-occurrence' }]), loadArticle });
    assert.ok('selected' in fourth && fourth.selected === 1);
    assert.equal(modelCalls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GROQ_API_KEY;
    if (oldLimit === undefined) delete process.env.RESEARCH_MAX_CANDIDATES; else process.env.RESEARCH_MAX_CANDIDATES = oldLimit;
  }
});

test('different publisher labels on one domain do not establish independent corroboration', async () => {
  const title = 'Escaped goat surprises bakery staff';
  const candidates = ['UPI Odd News', 'upi.com'].map((publisher, i) => ({ title, publisher, url: 'https://www.upi.com/story-' + i, publishedAt: new Date().toISOString(), localScore: 28 }));
  const result = await runDailyResearch({ discover: async () => ({ scanned: 2, unusualCandidates: 2, candidates, failures: [], note: 'QA' }), loadArticle: async () => { throw new Error('Excerpt only'); } });
  assert.ok('selected' in result && result.selected === 0);
});

test('the final candidate cap preserves Exa priority over keyword-heavy RSS', async () => {
  const previous = process.env.RESEARCH_MAX_CANDIDATES;
  process.env.RESEARCH_MAX_CANDIDATES = '1';
  const loaded: string[] = [];
  try {
    const candidates = [
      { title: 'Escaped goat emu robot chaos mystery', url: 'https://rss.example/story', publisher: 'RSS', localScore: 100, origin: 'rss' as const },
      { title: 'Town holds parade for a couch', url: 'https://exa.example/story', publisher: 'Exa discovery', localScore: 14, origin: 'exa' as const },
    ];
    await runDailyResearch({ discover: async () => ({ scanned: 2, unusualCandidates: 2, candidates, failures: [], note: 'QA' }),
      loadArticle: async url => { loaded.push(url); throw new Error('Excerpt only'); } });
    assert.deepEqual(loaded, ['https://exa.example/story']);
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_MAX_CANDIDATES; else process.env.RESEARCH_MAX_CANDIDATES = previous;
  }
});

test('failed database initialization can recover on the next request', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { getDatabase } from './lib/database.ts';
    process.env.TURSO_AUTH_TOKEN = 'test';
    await assert.rejects(getDatabase(), /TURSO_DATABASE_URL/);
    delete process.env.TURSO_AUTH_TOKEN;
    assert.equal((await getDatabase()).kind, 'sqlite');
  `], { encoding: 'utf8', env: process.env });
  assert.equal(result.status, 0, result.stderr);
});

test('health reports live when no demo mode is explicitly configured', async () => {
  assert.equal((await (await healthGet()).json()).mode, 'live');
});
