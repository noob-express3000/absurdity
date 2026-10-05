import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({headless:true, ...(process.env.QA_CHROMIUM_PATH
  ? {executablePath:process.env.QA_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {})});
const page = await browser.newPage({viewport:{width:1366,height:768}});
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let posts = 0, polls = 0, phase = 'idle', refreshed = false;
let archive;
await page.route('**/api/stories?*', async route => {
  const response = await route.fetch();
  archive ??= await response.json();
  if (!refreshed) { await route.fulfill({response}); return; }
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
  await route.fulfill({json:{run:{id:'qa-run',status,selected:1}}});
});
await page.goto(process.env.QA_BASE_URL || 'http://127.0.0.1:3000');
await page.locator('.story-row').first().waitFor();
assert.equal(posts, 0, 'page load must not launch discovery');
const icon = page.getByRole('button',{name:'New stories',exact:true});
await icon.click();
await icon.click();
assert.equal(await icon.getAttribute('aria-busy'), 'true');
await page.getByText('Stories refreshed.',{exact:true}).waitFor();
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
await page.getByText('Stories refreshed.',{exact:true}).waitFor();
assert.equal(posts, 3, 'reload must resume status without launching discovery');
assert.deepEqual(errors, []);
console.log('PASS explicit fetch, double-click guard, loading indicator, completion refresh, failure recovery, resume after reload, one-page layout, no page errors');
await browser.close();
