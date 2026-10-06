import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { POST } from '../app/api/narrate/route';

before(() => { delete process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_VOICE_ID; });
const request = () => new Request('http://localhost/api/narrate',{method:'POST',body:JSON.stringify({text:'Read this article.'})});

test('an API key alone reports the missing voice ID', async () => {
  try {
    process.env.ELEVENLABS_API_KEY='test-secret';
    const response=await POST(request());
    assert.equal(response.status,503);
    const result=await response.json();
    assert.match(result.error,/ELEVENLABS_VOICE_ID/);
    assert.equal(result.fallback,'browser-speech');
    assert.doesNotMatch(JSON.stringify(result),/test-secret/);
  } finally {delete process.env.ELEVENLABS_API_KEY;}
});

test('configured narration trims environment values and returns playable audio', async () => {
  const original=globalThis.fetch;
  try {
    process.env.ELEVENLABS_API_KEY=' test-secret ';
    process.env.ELEVENLABS_VOICE_ID=' selected-voice ';
    globalThis.fetch=async(url,init)=>{
      assert.match(String(url),/\/selected-voice$/);
      assert.equal((init?.headers as Record<string,string>)['xi-api-key'],'test-secret');
      assert.equal(JSON.parse(String(init?.body)).text,'Read this article.');
      return new Response(new Uint8Array([73,68,51,1]),{headers:{'content-type':'audio/mpeg'}});
    };
    const response=await POST(request());
    assert.equal(response.status,200);
    assert.equal(response.headers.get('content-type'),'audio/mpeg');
    assert.equal((await response.arrayBuffer()).byteLength,4);
  } finally {globalThis.fetch=original;delete process.env.ELEVENLABS_API_KEY;delete process.env.ELEVENLABS_VOICE_ID;}
});

test('provider failures expose actionable codes without echoing provider secrets or request content', async () => {
  const original=globalThis.fetch;
  try {
    process.env.ELEVENLABS_API_KEY='test-secret';
    process.env.ELEVENLABS_VOICE_ID='selected-voice';
    for (const [code, expected] of [['voice_not_found','voice ID'],['missing_permissions','permission'],['quota_exceeded','credits'],['unknown-secret-code','could not generate']]) {
      globalThis.fetch=async()=>Response.json({detail:{status:code,message:'test-secret private narration text'}},{status:401});
      const response=await POST(request());
      const body=await response.json();
      assert.equal(response.status,502);
      assert.equal(body.code,code==='unknown-secret-code'?'provider_error':code);
      assert.match(body.error,new RegExp(code==='unknown-secret-code'?'rejected':expected));
      assert.doesNotMatch(JSON.stringify(body),/test-secret|private narration text|unknown-secret-code/);
    }
    globalThis.fetch=async()=>Response.json({not:'audio'});
    assert.equal((await (await POST(request())).json()).code,'invalid_audio');
  } finally {globalThis.fetch=original;delete process.env.ELEVENLABS_API_KEY;delete process.env.ELEVENLABS_VOICE_ID;}
});
