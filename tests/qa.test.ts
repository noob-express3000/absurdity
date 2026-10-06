import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { spawnSync } from 'node:child_process';
import { GET as storiesGet } from '../app/api/stories/route';
import { POST as chatPost } from '../app/api/chat/route';
import { POST as narratePost } from '../app/api/narrate/route';
import { GET as healthGet } from '../app/api/health/route';
import { demoBriefing } from '../lib/demo-data';
import { PersistentStoryRepository, recordResearchRun, getLatestResearchRun, storyRepository } from '../lib/repository';
import { GroqIntelligenceProvider } from '../lib/providers/intelligence';
import { ElevenLabsVoiceProvider } from '../lib/providers/voice';
import { assertDatabaseReady, getDatabase } from '../lib/database';

before(() => {
  process.env.ABSURDITY_MODE = 'demo';
  process.env.ABSURDITY_SQLITE_PATH = ':memory:';
  for (const key of ['TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'ABSURDITY_REQUIRE_TURSO', 'RENDER', 'GROQ_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']) delete process.env[key];
});
const request = (body: unknown) => new Request('http://localhost/api', { method: 'POST', body: JSON.stringify(body) });

test('archive contains all fixtures and place search works', async () => {
  const all = await (await storiesGet(new Request('http://localhost/api/stories'))).json();
  assert.equal(all.stories.length, demoBriefing.stories.length);
  const result = await (await storiesGet(new Request('http://localhost/api/stories?q=South%20Africa'))).json();
  assert.ok(result.stories.length > 0);
  assert.ok(result.stories.every((story: any) => story.country === 'South Africa'));
});
test('archive rejects noninteger, negative, and oversized limits', async () => {
  for (const limit of ['NaN', '-1', '0', '2.5', '501', 'Infinity']) {
    assert.equal((await storiesGet(new Request('http://localhost/api/stories?limit=' + limit))).status, 400);
  }
});
test('malformed chat requests are client errors', async () => {
  for (const body of [null, {}, {message: '  '}, {message: 7}]) assert.equal((await chatPost(request(body))).status, 400);
  assert.equal((await chatPost(new Request('http://localhost/api', {method:'POST', body:'{'}))).status, 400);
});
test('demo conversation is grounded and explicitly identifies fixtures', async () => {
  const africa = await (await chatPost(request({message:'Anything from Africa?'}))).json();
  assert.match(africa.text, /South Africa/);
  const verification = await (await chatPost(request({message:'Did this actually happen?'}))).json();
  assert.match(verification.text, /fixture/i);
});
test('conversation includes an archived selected story outside the current briefing', async () => {
  const originalFetch = globalThis.fetch;
  const originalBriefing = storyRepository.getCurrentBriefing;
  const originalStory = storyRepository.getStory;
  const oldKey = process.env.GROQ_API_KEY;
  try {
    process.env.GROQ_API_KEY = 'fake';
    const archived = {...demoBriefing.stories[0],id:'archived-selection',isFixture:false};
    storyRepository.getCurrentBriefing = async () => ({...demoBriefing,mode:'live',stories:[]});
    storyRepository.getStory = async () => archived;
    globalThis.fetch = async (_url,init) => {
      const body = JSON.parse(String(init?.body));
      assert.match(body.input,/archived-selection/);
      return Response.json({output_text:'A grounded archived story answer.'});
    };
    const result = await (await chatPost(request({message:'Tell me more',storyId:archived.id}))).json();
    assert.equal(result.provider,'groq');
    assert.equal(result.text,'A grounded archived story answer.');
  } finally {
    globalThis.fetch = originalFetch;
    storyRepository.getCurrentBriefing = originalBriefing;
    storyRepository.getStory = originalStory;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY; else process.env.GROQ_API_KEY = oldKey;
  }
});
test('narration validates inputs and returns browser fallback without credentials', async () => {
  assert.equal((await narratePost(request(null))).status, 400);
  assert.equal((await narratePost(new Request('http://localhost/api', {method:'POST',body:'{'}))).status, 400);
  const response = await narratePost(request({text:'Read this story'}));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).fallback, 'browser-speech');
});
test('healthy local database reports ready without caching', async () => {
  const response = await healthGet();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).database.ready, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('empty database initialization is repeatable and preserves startup records', () => {
  const script = [
    "const {assertDatabaseReady}=await import('./lib/database.ts');",
    "const {recordResearchRun,getLatestResearchRun}=await import('./lib/repository.ts');",
    "await assertDatabaseReady();",
    "await recordResearchRun({id:'startup-record',startedAt:'2026-10-06T00:00:00.000Z',windowStart:'2026-10-05T00:00:00.000Z',windowEnd:'2026-10-06T00:00:00.000Z',status:'complete',scanned:1,candidates:1,selected:1,failures:[],providerUsage:{}});",
    "await assertDatabaseReady();",
    "if((await getLatestResearchRun())?.id!=='startup-record') process.exit(2);",
  ].join(' ');
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    env: {...process.env,ABSURDITY_SQLITE_PATH:':memory:',ABSURDITY_REQUIRE_TURSO:'false',RENDER:'false',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:''},
    encoding:'utf8',
  });
  assert.equal(result.status,0,result.stderr);
});
test('Render refuses to boot without Turso instead of silently falling back to SQLite', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "const {GET}=await import('./app/api/health/route.ts'); const r=await GET(); const body=await r.json(); if(r.status!==503||body.database.kind!=='turso') process.exit(1);"],
    {env:{...process.env,RENDER:'true',ABSURDITY_REQUIRE_TURSO:'true',TURSO_DATABASE_URL:'',TURSO_AUTH_TOKEN:'',ABSURDITY_SQLITE_PATH:':memory:'},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('missing Turso authentication fails readiness with 503', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "const {GET}=await import('./app/api/health/route.ts'); const r=await GET(); if(r.status!==503) process.exit(1);"],
    {env:{...process.env,TURSO_DATABASE_URL:'libsql://invalid.test',TURSO_AUTH_TOKEN:''},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('persistent stories roundtrip with sources and research, retain old history, and exclude future dates', async () => {
  const repository = new PersistentStoryRepository();
  const recent = {...demoBriefing.stories[0], id:'qa-recent', publicationDate:new Date().toISOString()};
  const old = {...recent, id:'qa-old', publicationDate:'2020-01-01T00:00:00.000Z'};
  const future = {...recent, id:'qa-future', publicationDate:'2099-01-01T00:00:00.000Z'};
  for (const story of [recent,old,future]) await repository.upsertStory(story);
  assert.deepEqual(await repository.getStory(recent.id), recent);
  await repository.upsertStory({...recent, summary:'Updated story'});
  assert.equal((await repository.getStory(recent.id))?.summary, 'Updated story');
  assert.deepEqual((await repository.getCurrentBriefing()).stories.map(story=>story.id), [recent.id]);
  assert.equal((await repository.searchStories('')).length, 3);
  assert.deepEqual((await repository.searchStories('animal Australia',500,{before:'2021-01-01T00:00:00.000Z'})).map(story=>story.id),[old.id]);
  assert.equal((await repository.searchStories('%')).length,0);
  assert.equal(await repository.getStory('missing'), null);
});
test('history archive hydrates any number of stories in three database queries', async () => {
  const repository = new PersistentStoryRepository();
  for (let index = 0; index < 8; index++) {
    await repository.upsertStory({
      ...demoBriefing.stories[index % demoBriefing.stories.length],
      id: 'qa-batch-' + index,
      publicationDate: new Date(Date.now() - index * 1000).toISOString(),
      isFixture: false,
    });
  }

  const database = await getDatabase();
  const originalQuery = database.query.bind(database);
  let queries = 0;
  (database as any).query = async (...args: any[]) => {
    queries += 1;
    return originalQuery(...args);
  };

  try {
    const stories = await repository.searchStories('', 500);
    assert.ok(stories.length >= 8);
    assert.equal(queries, 3);
    const batched = stories.find(story => story.id === 'qa-batch-0');
    assert.ok(batched?.sources.length);
    assert.ok(batched?.research.length);
  } finally {
    (database as any).query = originalQuery;
  }
});

test('archive validates date filters and applies them before limiting results', async () => {
  assert.equal((await storiesGet(new Request('http://localhost/api/stories?from=invalid'))).status,400);
  const result = await (await storiesGet(new Request('http://localhost/api/stories?before=2020-01-01T00:00:00.000Z'))).json();
  assert.equal(result.stories.length,0);
});
test('weaker reanalysis preserves previously selected archive entries and evidence', async () => {
  const repository = new PersistentStoryRepository();
  const original = await repository.getStory('qa-old');
  assert.ok(original);
  await repository.upsertStory({...original, status:'candidate', sources:[], summary:'Weaker fallback'});
  assert.deepEqual(await repository.getStory('qa-old'),original);
  assert.ok((await repository.searchStories('')).some(story=>story.id==='qa-old'));
});
test('failed story updates roll back the story and child rows atomically', async () => {
  const repository = new PersistentStoryRepository();
  const original = {...demoBriefing.stories[0],id:'qa-atomic',isFixture:false};
  await repository.upsertStory(original);
  const broken = {
    ...original,
    summary:'This must roll back',
    sources:[{...original.sources[0],publisher:'Replacement publisher'}],
    research:[{label:'Broken child write',detail:'Force NOT NULL failure',status:'complete' as const,at:null as any}],
  };
  await assert.rejects(() => repository.upsertStory(broken));
  const saved = await repository.getStory(original.id);
  assert.equal(saved?.summary, original.summary);
  assert.deepEqual(saved?.sources, original.sources);
  assert.deepEqual(saved?.research, original.research);
});
test('research run telemetry updates the existing run', async () => {
  const run = {id:'qa-run', startedAt:new Date().toISOString(),windowStart:'2026-10-01T00:00:00Z',windowEnd:'2026-10-02T00:00:00Z',status:'running' as const, scanned:0,candidates:0,selected:0,failures:[],providerUsage:{}};
  await recordResearchRun(run);
  await recordResearchRun({...run,status:'complete',scanned:10,selected:2});
  assert.equal((await getLatestResearchRun())?.selected,2);
});
test('Groq parsing rejects string selection flags, invalid dates and invented source URLs', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({output_text:JSON.stringify({selected:'false',confidence:'high',eventDate:'tomorrow-ish',corroboratingUrls:['https://invented.invalid'],absurdityScore:999})});
    const result = await new GroqIntelligenceProvider('fake').analyzeCandidate({title:'Rare robot',publisher:'Test',localScore:20,evidence:[{title:'Rare robot',publisher:'Test',url:'https://test.invalid/real'}]});
    assert.equal(result.selected,false);
    assert.equal(result.eventDate,null);
    assert.deepEqual(result.corroboratingUrls,[]);
    assert.equal(result.absurdityScore,100);
  } finally { globalThis.fetch = original; }
});
test('provider failures propagate for safe route fallback', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('', {status:429});
    await assert.rejects(()=>new GroqIntelligenceProvider('fake').converse('Hello',[]),/429/);
    await assert.rejects(()=>new ElevenLabsVoiceProvider('fake','fake').synthesize('Hello'),/429/);
  } finally { globalThis.fetch = original; }
});
