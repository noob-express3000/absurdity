import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { validateConversationPlan } from '../lib/conversation';
import { GroqIntelligenceProvider } from '../lib/providers/intelligence';
import { replyToVoice } from '../lib/voice-agent';
import { demoBriefing } from '../lib/demo-data';
import { storyRepository } from '../lib/repository';
import { POST } from '../app/api/chat/route';

before(() => { process.env.ABSURDITY_SQLITE_PATH = ':memory:'; delete process.env.GROQ_API_KEY; });
const plan = { text: 'Here is the explanation.', action: 'none', view: null, storyId: null, query: null, from: null, before: null, read: false };
const context = {message:'Tell me more',scope:'home' as const,visibleIds:[],history:[],displayMode:'demo' as const,storyId:demoBriefing.stories[0].id};

test('conversation rejects invented actions, story IDs and invalid archive boundaries', () => {
  for (const change of [{action:'web-search'},{action:'select',storyId:'invented'},{action:'search',view:'home'},{from:'tomorrow'},{from:'2026-10-02T00:00:00Z',before:'2026-10-01T00:00:00Z'},{text:''},{read:'true'}]) {
    assert.throws(() => validateConversationPlan({...plan,...change},new Set()));
  }
});

test('Groq receives selected article, prior turns and strict schema; reasoning is excluded', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (_url,init) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.input);
      assert.equal(input.stories[0].detailedSummary,demoBriefing.stories[0].detailedSummary);
      assert.equal(input.context.history[0].content,'What happened?');
      assert.equal(body.text.format.type,'json_schema');
      assert.equal(body.text.format.strict,true);
      assert.equal(body.tools,undefined);
      return Response.json({output:[{type:'reasoning',content:[{type:'reasoning_text',text:'Private reasoning'}]}, {type:'message',content:[{type:'output_text',text:JSON.stringify(plan)}]}]});
    };
    const result = await new GroqIntelligenceProvider('fake').planConversation(context.message,[demoBriefing.stories[0]],{storyId:context.storyId,scope:'home',visibleIds:[],history:[{role:'user',content:'What happened?'}],now:new Date().toISOString(),mode:'demo'});
    assert.equal(result.text,plan.text);
  } finally { globalThis.fetch = original; }
});

test('ordinary story questions send only the selected story to Groq', async () => {
  const original = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = 'fake';
    const current = demoBriefing.stories[0];
    const other = demoBriefing.stories[1];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.input);
      assert.deepEqual(input.stories.map((story:any) => story.id), [current.id]);
      return Response.json({output_text:JSON.stringify(plan)});
    };
    const result = await replyToVoice({
      ...context,
      storyId: current.id,
      visibleIds: [other.id],
      message: 'Why is this weird?',
    });
    assert.equal(result.provider, 'groq');
  } finally {
    globalThis.fetch = original;
    delete process.env.GROQ_API_KEY;
  }
});

test('conversation keeps every visible story while sending rich evidence only for the current story', async () => {
  const original = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = 'fake';
    const current = demoBriefing.stories[0];
    const other = demoBriefing.stories[1];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const input = JSON.parse(body.input);
      assert.deepEqual(input.stories.map((story:any) => story.id), [current.id, other.id]);
      assert.equal(input.stories[0].detailedSummary, current.detailedSummary);
      assert.deepEqual(input.stories[0].sources, current.sources);
      assert.equal(input.stories[1].summary, other.summary);
      assert.equal(input.stories[1].absurdityScore, other.absurdityScore);
      assert.equal(input.stories[1].detailedSummary, undefined);
      assert.equal(input.stories[1].sources, undefined);
      return Response.json({output_text:JSON.stringify(plan)});
    };
    const result = await replyToVoice({
      ...context,
      storyId: current.id,
      visibleIds: [other.id],
      message: 'Compare these stories',
    });
    assert.equal(result.provider, 'groq');
  } finally {
    globalThis.fetch = original;
    delete process.env.GROQ_API_KEY;
  }
});

test('voice search executes the full stored archive locally without spending a Groq call', async () => {
  const original = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = 'fake';
    globalThis.fetch = async () => { throw new Error('Archive search must not call Groq'); };
    const result = await replyToVoice({...context,message:'Find South African stories'});
    assert.equal(result.provider,'deterministic');
    assert.ok(result.stories!.length > 0);
    assert.ok(result.stories!.every(story => story.country === 'South Africa'));
    assert.match(result.text,/demo/);
  } finally { globalThis.fetch = original; delete process.env.GROQ_API_KEY; }
});

test('malformed Groq plans fall back safely and live mode never substitutes fixtures', async () => {
  const originalFetch = globalThis.fetch;
  const originalBriefing = storyRepository.getCurrentBriefing;
  const originalStory = storyRepository.getStory;
  try {
    process.env.GROQ_API_KEY = 'fake';
    globalThis.fetch = async () => Response.json({output_text:JSON.stringify({...plan,action:'select',storyId:'invented'})});
    storyRepository.getCurrentBriefing = async () => ({...demoBriefing,mode:'live',stories:[]});
    storyRepository.getStory = async () => null;
    const result = await replyToVoice({...context,displayMode:'live'});
    assert.equal(result.provider,'safe-fallback');
    assert.equal(result.action.action,'none');
    assert.match(result.text,/temporarily unavailable/);
    assert.doesNotMatch(result.text,/emu|goat|fixture/i);
  } finally {
    globalThis.fetch = originalFetch;
    storyRepository.getCurrentBriefing = originalBriefing;
    storyRepository.getStory = originalStory;
    delete process.env.GROQ_API_KEY;
  }
});

test('voice route limits oversized requests and deterministic search works only in server demo mode', async () => {
  const request = (body:unknown) => new Request('http://localhost/api/chat',{method:'POST',body:JSON.stringify(body)});
  assert.equal((await POST(request({message:'a'.repeat(2001),voice:true}))).status,400);
  const oldMode = process.env.ABSURDITY_MODE;
  try {
    process.env.ABSURDITY_MODE = 'demo';
    const response = await POST(request({...context,message:'find animal stories in my favorites',voice:true}));
    assert.equal(response.status,200);
    const body = await response.json();
    assert.equal(body.action.action,'search');
    assert.equal(body.action.view,'favorites');
    assert.equal(body.provider,'deterministic');
  } finally {
    if (oldMode === undefined) delete process.env.ABSURDITY_MODE; else process.env.ABSURDITY_MODE = oldMode;
  }
});

test('explicit refresh returns a real refresh action without asking Groq or searching the archive', async () => {
  const original = globalThis.fetch;
  const search = storyRepository.searchStories;
  try {
    process.env.GROQ_API_KEY = 'fake';
    globalThis.fetch = async () => { throw new Error('Must not ask Groq to interpret refresh'); };
    storyRepository.searchStories = async () => { throw new Error('Must not search for the word refresh'); };
    const result = await replyToVoice({...context, message:'Refresh the stories'});
    assert.equal(result.action.action, 'refresh');
    assert.equal(result.intent, 'refresh');
    assert.equal(result.stories, undefined);
    assert.doesNotMatch(result.text, /have been refreshed/);
  } finally {globalThis.fetch=original;storyRepository.searchStories=search;delete process.env.GROQ_API_KEY;}
});

test('a model cannot initiate refresh from an unrelated request', async () => {
  const original = globalThis.fetch;
  try {
    process.env.GROQ_API_KEY = 'fake';
    globalThis.fetch = async () => Response.json({output_text:JSON.stringify({...plan,action:'refresh'})});
    const result = await replyToVoice({...context,message:'Hello'});
    assert.notEqual(result.action.action,'refresh');
  } finally {globalThis.fetch=original;delete process.env.GROQ_API_KEY;}
});
