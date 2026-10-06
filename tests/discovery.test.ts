import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { runLightweightDiscovery } from '../lib/research';
import { runDailyResearch } from '../lib/pipeline';
import { getLatestResearchRun, PersistentStoryRepository } from '../lib/repository';

before(() => {
  process.env.ABSURDITY_SQLITE_PATH = ':memory:';
  for (const key of ['GROQ_API_KEY','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN','TAVILY_API_KEY','EXA_API_KEY']) delete process.env[key];
});

test('recent odd-news candidates survive stale high-score headlines and the final pipeline ingests a batch', async () => {
  const now = Date.now();
  const freshTitles = ['Dancer balances dozens of spoons', 'Neighbours hold a parade for a couch', 'Bakery makes a hat from bread'];
  const discovery = await runLightweightDiscovery({parseFeed:async url => ({items:
    url.includes('bbci') ? [...Array.from({length:20}, (_, index) => ({title:'Escaped goat emu robot mystery chaos '+index,
      link:'https://news.example/old-'+index, isoDate:new Date(now - 7 * 86400000).toISOString()})), {title:'Escaped goat emu robot in the future',link:'https://news.example/future',isoDate:new Date(now + 86400000).toISOString()}] :
    url.includes('upi') ? freshTitles.map((title,index)=>({title, link:'https://news.example/fresh-'+index,
      pubDate:new Date(now - index * 1000).toUTCString(), contentSnippet:'A factual report about an unusual community event.'})) : []
  })});
  assert.equal(discovery.candidates.length, 24);
  assert.ok(discovery.candidates.filter(candidate=>candidate.publisher==='UPI Odd News').every(candidate=>candidate.localScore>=12));
  const original = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY='fake';
    globalThis.fetch=async()=>Response.json({output_text:JSON.stringify({selected:true,confidence:'high',
      summary:'A local event was safely resolved.',detailedSummary:'The organisers explained how the unusual event happened.',corroboratingUrls:[]})});
    const result=await runDailyResearch({discover:async()=>discovery,loadArticle:async url=>({url,
      html:'<html><body><article>'+Array.from({length:10},()=>'<p>Residents watched the unusual community event and the organisers explained how it happened safely. The reporter spoke with participants and recorded the outcome in detail.</p>').join('')+'</article></body></html>'})});
    assert.ok('selected' in result);
    assert.equal(result.candidates,3);
    assert.equal(result.selected,3);
    assert.equal(result.providerUsage.articlesExtracted,3);
    const stories=await new PersistentStoryRepository().searchStories('');
    assert.equal(stories.length,3);
    assert.ok(stories.every(story=>/^\d{4}-\d{2}-\d{2}T/.test(story.publicationDate)));
    assert.equal((await new PersistentStoryRepository().getCurrentBriefing()).stories.length,3);
    assert.equal((await getLatestResearchRun())?.scanned,24);
  } finally {globalThis.fetch=original;delete process.env.GROQ_API_KEY;}
});
