import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless:true, ...(process.env.QA_CHROMIUM_PATH
  ? {executablePath:process.env.QA_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const page = await browser.newPage({viewport:{width:1366,height:768}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let posts = 0, polls = 0, phase = 'idle', refreshed = false;
let archive, emptyArchive = false;
let chats = 0;
page.on('request', request => { if (request.url().includes('/api/chat')) chats++; });
await page.route('**/api/narrate', route => route.fulfill({status:503,json:{}}));
await page.addInitScript(() => {
  window.speechSynthesis.speak = () => {};
  window.speechSynthesis.cancel = () => {};
});
await page.route('**/api/stories?*', async route => {
  const response = await route.fetch();
  archive ??= await response.json();
  if (!refreshed) { await route.fulfill({response}); return; }
  if (emptyArchive) { await route.fulfill({json:{mode:'live',stories:[]}}); return; }
  const story = {...archive.stories[0], id:'live-qa-refresh', title:'Fresh article from the fetch cycle',
    publicationDate:new Date().toISOString(), eventDate:new Date().toISOString(), isFixture:false};
  await route.fulfill({json:{mode:'live',stories:[story]}});
});
await page.route('**/api/research*', async route => {
  const request = route.request();
  if (request.method() === 'POST') {
    posts++;
    if (phase === 'unavailable') { await route.fulfill({status:503,json:{error:'Could not start a fetch cycle.'}}); return; }
    phase = phase === 'failed' ? 'failed' : 'running';
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({status:202,json:{started:true,run:{id:'qa-run',status:'running'}}});
    return;
  }
  if (phase === 'idle') { await route.fulfill({json:{run:null}}); return; }
  polls++;
  const status = phase === 'failed' ? 'failed' : polls > 1 ? 'complete' : 'running';
  if (status === 'complete') refreshed = true;
  await route.fulfill({json:{run:{id:'qa-run',status,selected:1,candidates:3,scanned:20}}});
});
await page.goto(process.env.QA_BASE_URL || 'http://127.0.0.1:3000');
await page.locator('.story-row').first().waitFor();
assert.equal(posts, 0, 'page load must not launch discovery');
const icon = page.getByRole('button',{name:'New stories',exact:true});
await icon.click();
await icon.click();
assert.equal(await icon.getAttribute('aria-busy'), 'true');
await page.getByText('Reviewed 3 candidates; selected 1 story.',{exact:true}).waitFor();
assert.equal(posts, 1, 'repeated clicks must share a run');
assert.equal(await icon.getAttribute('aria-busy'), 'false');
await page.getByRole('heading',{name:'Fresh article from the fetch cycle',exact:true}).waitFor();
assert.equal(await page.evaluate(()=>document.documentElement.scrollHeight <= innerHeight), true);

phase = 'failed'; polls = 0;
await icon.click();
await page.getByText('Fetch interrupted. Try again shortly.',{exact:true}).waitFor();
assert.equal(await icon.getAttribute('aria-busy'), 'false');
assert.equal(polls, 1, 'failed status must stop polling');
await page.getByRole('heading',{name:'Fresh article from the fetch cycle',exact:true}).waitFor();

phase = 'unavailable';
await icon.click();
await page.getByText('Could not start a fetch cycle.',{exact:true}).waitFor();
assert.equal(await icon.getAttribute('aria-busy'), 'false');

phase = 'running'; polls = 0;
await page.reload();
await page.getByText('Reviewed 3 candidates; selected 1 story.',{exact:true}).waitFor();
assert.equal(posts, 3, 'reload must resume status without launching discovery');

// Typed refresh must launch research, keep History/current article visible, and survive an empty archive response.
phase = 'running'; polls = 0; emptyArchive = true;
await page.getByRole('button',{name:'History',exact:true}).click();
await page.getByRole('button',{name:'Type to Absurdity',exact:true}).click();
await page.getByRole('textbox',{name:'Ask Absurdity to navigate'}).fill('Refresh the stories');
await page.getByRole('button',{name:'Send instruction',exact:true}).click();
assert.equal(await icon.getAttribute('aria-busy'), 'true');
await page.getByRole('heading',{name:'Fresh article from the fetch cycle',exact:true}).waitFor();
assert.equal(await page.locator('nav button[aria-current]').innerText(),'History');
await page.locator('.agent-prompt').getByText('Reviewed 3 candidates; selected 1 story.',{exact:true}).waitFor();
assert.equal(posts, 4);
assert.equal(chats, 0, 'explicit refresh must not search the archive or ask Groq');
await page.getByRole('heading',{name:'Fresh article from the fetch cycle',exact:true}).waitFor();
await page.getByRole('button',{name:'Close instruction box'}).click();
if (process.env.QA_SCREENSHOT_DIR) await page.screenshot({path:process.env.QA_SCREENSHOT_DIR+'/reader-refresh-qa.png'});

await page.route('**/api/narrate', route => route.fulfill({status:502,json:{error:'ElevenLabs could not find the configured voice ID.',code:'voice_not_found',fallback:'browser-speech'}}));
if (await page.getByRole('button',{name:'Stop reading',exact:true}).count()) await page.getByRole('button',{name:'Stop reading',exact:true}).click();
await page.getByRole('button',{name:'Read aloud',exact:true}).click();
await page.getByText('ElevenLabs could not find the configured voice ID. Using device voice.',{exact:true}).waitFor();
assert.deepEqual(errors, []);
console.log('PASS explicit fetch, double-click guard, loading indicator, completion refresh, failure recovery, resume after reload, typed refresh without archive search, empty-response retention, one-page layout, no page errors');
await browser.close();
