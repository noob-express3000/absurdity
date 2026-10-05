import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { before, test } from 'node:test';
import { extractArticle, fetchPublicPage, ingestSource, isPublicAddress, resolveArticleTarget, requestArticlePage, type ArticleTransport } from '../lib/articles';
import { getStoryEvidence, PersistentStoryRepository, saveStoryEvidence, getLatestResearchRun } from '../lib/repository';
import { demoBriefing } from '../lib/demo-data';
import { runDailyResearch } from '../lib/pipeline';
import { GroqIntelligenceProvider } from '../lib/providers/intelligence';

before(() => {
  process.env.ABSURDITY_SQLITE_PATH = ':memory:';
  for (const key of ['GROQ_API_KEY','EXA_API_KEY','TAVILY_API_KEY','TURSO_DATABASE_URL','TURSO_AUTH_TOKEN']) delete process.env[key];
});
const paragraph = 'Residents watched the escaped robot return to the same bakery, while staff safely guided it away from the pavement. The owner explained that a damaged boundary sensor had sent the machine in an unexpected direction. ';
const html = `<html><head><title>Escaped robot visits bakery</title></head><body><nav>UNRELATED NAVIGATION</nav><article><h1>Escaped robot visits bakery</h1>${Array.from({length:12},()=>`<p>${paragraph}</p>`).join('')}<p>TAIL_EVIDENCE: The owner replaced the sensor and the robot returned to its park.</p><p hidden>HIDDEN PROMOTION</p></article><footer>UNRELATED FOOTER</footer><script>globalThis.articleScriptExecuted=true</script></body></html>`;
const source = {url:'https://news.example/robot',title:'Escaped robot visits bakery',publisher:'Test News',text:'A short RSS teaser.',kind:'rss' as const};
const publicResolve = async () => [{address:'8.8.8.8',family:4}];
const response = (status:number, body:string, headers:Record<string,string> = {'content-type':'text/html'}) => ({status,headers,body:(async function*(){yield Buffer.from(body);})(),close:()=>{}});

test('article extraction retains paragraphs and tail evidence while removing page chrome and scripts', () => {
  const article = extractArticle({html,url:source.url});
  assert.match(article.text,/TAIL_EVIDENCE/);
  assert.ok(article.text.length > 1600);
  assert.match(article.text,/\n\n/);
  assert.doesNotMatch(article.text,/UNRELATED|HIDDEN PROMOTION|articleScriptExecuted/);
  assert.equal((globalThis as any).articleScriptExecuted,undefined);
  assert.equal(article.truncated,false);
});

test('restricted and non-article pages remain excerpts, with retrieval failure recorded', async () => {
  const restricted = html.replace('</head>','<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script></head>');
  const result = await ingestSource(source,async()=>({html:restricted,url:source.url}));
  assert.equal(result.status,'excerpt');
  assert.equal(result.text,source.text);
  assert.match(result.error!,/restricted/);
  assert.throws(()=>extractArticle({html:'<html><title>Access denied</title><body>Please log in</body></html>',url:source.url}),/No readable/);
  const missing = await ingestSource({...source,text:undefined},async()=>{throw new Error('Article HTTP 403.');});
  assert.equal(missing.status,'unavailable');
});

test('article fetch rejects private IPs, DNS answers and redirects before opening a socket', async () => {
  for (const address of ['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.168.1.1','::1','fc00::1','::ffff:127.0.0.1']) assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress('8.8.8.8'),true);
  await assert.rejects(()=>resolveArticleTarget('http://127.1/article'),/public/);
  await assert.rejects(()=>resolveArticleTarget('https://news.example/',async()=>[{address:'10.0.0.1',family:4}]),/public/);
  await assert.rejects(()=>resolveArticleTarget('https://user:pass@news.example/'),/Unsupported/);
  let calls = 0;
  const transport:ArticleTransport = async target => { calls++; assert.equal(target.address.address,'8.8.8.8'); return response(302,'',{location:'http://169.254.169.254/latest/meta-data'}); };
  await assert.rejects(()=>fetchPublicPage(source.url,{resolve:publicResolve,transport}),/public/);
  assert.equal(calls,1);
});

test('article fetch bounds redirects, content type, bytes and DNS timeout', async () => {
  for (const transport of [async()=>response(200,'x',{'content-type':'application/pdf'}),async()=>response(200,'x'.repeat(100))]) {
    await assert.rejects(()=>fetchPublicPage(source.url,{resolve:publicResolve,transport,maxBytes:10}),/not HTML|too large/);
  }
  let requests = 0;
  await assert.rejects(()=>fetchPublicPage(source.url,{resolve:publicResolve,transport:async()=>{requests++;return response(302,'',{location:'/again'});}}),/redirect limit/);
  assert.equal(requests,5);
  const result = await fetchPublicPage(source.url,{resolve:publicResolve,transport:async target=>target.url.pathname==='/robot' ? response(302,'',{location:'/resolved'}) : response(200,html)});
  assert.equal(result.url,'https://news.example/resolved');
  await assert.rejects(()=>fetchPublicPage(source.url,{timeoutMs:5,resolve:async()=>{await new Promise(r=>setTimeout(r,20));return publicResolve();}}),/timed out/);
});

test('full evidence survives persistence and weaker rechecks, and stays out of reader responses', async () => {
  const story = {...demoBriefing.stories[0],id:'qa-article-storage'};
  const repository = new PersistentStoryRepository();
  await repository.upsertStory(story);
  const full = await ingestSource(source,async()=>({html,url:source.url}));
  await saveStoryEvidence(story.id,[full]);
  assert.deepEqual(await getStoryEvidence(story.id),[full]);
  await saveStoryEvidence(story.id,[await ingestSource(source,async()=>{throw new Error('Unavailable');})]);
  assert.equal((await getStoryEvidence(story.id))[0].text,full.text);
  assert.deepEqual(await repository.getStory(story.id),story);
});

test('daily research extracts before analysis and persists full bodies with source provenance', async () => {
  const original = globalThis.fetch;
  let analysisCalls = 0;
  try {
    process.env.GROQ_API_KEY = 'fake';
    globalThis.fetch = async (_url,init) => {
      analysisCalls++;
      const input=JSON.parse(String(init?.body)).input;
      assert.match(input,/TAIL_EVIDENCE/);
      assert.match(input,/"status":"article"/);
      return Response.json({output_text:JSON.stringify({selected:true,confidence:'high',summary:'The robot was returned safely.',detailedSummary:'Its sensor was replaced and it returned to the park.',corroboratingUrls:[source.url],country:'Testland'})});
    };
    const result = await runDailyResearch({loadArticle:async url=>({html,url}),discover:async()=>({scanned:1,unusualCandidates:1,failures:[],note:'Fixture discovery',candidates:[{...source,snippet:source.text,publishedAt:new Date().toISOString(),localScore:28}]})});
    assert.equal(result.selected,1);
    assert.equal(result.providerUsage.articlesExtracted,1);
    assert.equal(analysisCalls,1);
    const story=(await new PersistentStoryRepository().searchStories('robot')).find(story=>!story.isFixture)!;
    assert.ok(story);
    assert.match((await getStoryEvidence(story.id))[0].text,/TAIL_EVIDENCE/);
    assert.equal((await getStoryEvidence(story.id))[0].resolvedUrl,source.url);
    assert.ok(story.research.some(step=>step.label==='Article extraction'));
    assert.equal((await getLatestResearchRun())?.selected,1);
  } finally {globalThis.fetch=original;delete process.env.GROQ_API_KEY;}
});

test('daily research retains candidates when article retrieval fails', async () => {
  const result = await runDailyResearch({loadArticle:async()=>{throw new Error('Article HTTP 403.');},discover:async()=>({scanned:1,unusualCandidates:1,failures:[],note:'Fixture discovery',candidates:[{...source,url:source.url+'/blocked',snippet:source.text,publishedAt:new Date().toISOString(),localScore:28}]})});
  assert.equal(result.candidates,1);
  assert.equal(result.selected,0);
  assert.equal(result.providerUsage.articleFallbacks,1);
  assert.ok(result.failures.some(error=>error.includes('Article HTTP 403')));
});

test('Groq receives long article text with explicit model clipping and a bounded text budget', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch=async(_url,init)=>{
      const input=JSON.parse(String(init?.body)).input;
      const evidence=JSON.parse(input.split('EVIDENCE:\n')[1]);
      assert.ok(evidence.every((item:any)=>item.modelTextTruncated));
      assert.equal(evidence.reduce((sum:number,item:any)=>sum+item.text.length,0),24000);
      assert.ok(evidence[0].text.length>1600);
      return Response.json({output_text:'{"selected":false}'});
    };
    await new GroqIntelligenceProvider('fake').analyzeCandidate({title:source.title,publisher:source.publisher,localScore:28,evidence:Array.from({length:3},()=>({...source,text:'x'.repeat(100000),status:'article' as const}))});
  } finally {globalThis.fetch=original;}
});

test('an article that fits the total model budget is not clipped just because other sources are short', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async(_url,init)=>{
      const evidence=JSON.parse(JSON.parse(String(init?.body)).input.split('EVIDENCE:\n')[1]);
      assert.equal(evidence[0].text.length,20000);
      assert.ok(evidence.every((item:any)=>!item.modelTextTruncated));
      return Response.json({output_text:'{"selected":false}'});
    };
    await new GroqIntelligenceProvider('fake').analyzeCandidate({title:source.title,publisher:source.publisher,localScore:28,evidence:[{...source,text:'x'.repeat(20000),status:'article'},...Array.from({length:7},()=>({...source,text:'excerpt'.repeat(40)}))]});
  } finally {globalThis.fetch=original;}
});


test('native article transport pins the socket address and streams the HTML response', async () => {
  // Exercise the socket layer against a local test server; public-URL validation is tested separately.
  const server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html'});response.end(html);});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address();
    assert.ok(address && typeof address !== 'string');
    const response=await requestArticlePage({url:new URL(`http://unresolvable.invalid:${address.port}/article`),address:{address:'127.0.0.1',family:4}},AbortSignal.timeout(2000));
    const chunks:Buffer[]=[];
    for await (const chunk of response.body) chunks.push(Buffer.from(chunk));
    assert.equal(response.status,200);
    assert.equal(Buffer.concat(chunks).toString(),html);
    response.close();
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error ? reject(error) : resolve()));}
});


test('article extraction honors the publisher response encoding', () => {
  const encoded=Buffer.from(html.replace('TAIL_EVIDENCE','CAFÉ_EVIDENCE'),'latin1');
  const result=extractArticle({html:encoded,url:source.url,contentType:'text/html; charset=iso-8859-1'});
  assert.match(result.text,/CAFÉ_EVIDENCE/);
});
