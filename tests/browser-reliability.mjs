import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH
  ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  const errors = [];
  const archiveAlert = page.locator('.agent-reply[role="alert"]');
  page.on('pageerror', error => errors.push(error.message));
  const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
  const seed = (await (await page.request.get(base + '/api/stories')).json()).stories[0];
  const story = { ...seed, id: 'live-recovery-qa', title: 'Saved story after archive recovery',
    publicationDate: new Date().toISOString(), isFixture: false };
  let phase = 'unavailable';
  let researchPosts = 0;
  await page.route('**/api/research*', route => {
    if (route.request().method() === 'POST') researchPosts++;
    return route.fulfill({ json: { run: null } });
  });
  await page.route('**/api/stories?*', route => phase === 'unavailable'
    ? route.fulfill({ status: 503, json: { error: 'Archive unavailable' } })
    : route.fulfill({ json: phase === 'malformed' ? { stories: [] } : { mode: 'live', stories: [story] } }));

  await page.goto(base);
  await archiveAlert.waitFor();
  assert.equal(await page.locator('.story-row').count(), 0, 'failed load must not invent a demo feed');
  assert.equal(await page.getByText('Loading stories…', { exact: true }).count(), 0);
  phase = 'malformed';
  const invalidResponse = page.waitForResponse(response => response.url().includes('/api/stories?'));
  await page.getByRole('button', { name: 'Retry loading stories' }).click();
  await invalidResponse;
  assert.equal(await page.locator('.story-row').count(), 0, 'missing mode must not activate demo');
  phase = 'live';
  await page.getByRole('button', { name: 'Retry loading stories' }).click();
  await page.getByRole('heading', { name: story.title, exact: true }).waitFor();
  assert.equal(await archiveAlert.count(), 0);

  phase = 'unavailable';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await archiveAlert.waitFor();
  assert.equal(await page.getByRole('heading', { name: story.title, exact: true }).count(), 1, 'failed background load preserves cached stories');
  phase = 'live';
  await page.getByRole('button', { name: 'Retry loading stories' }).click();
  await archiveAlert.waitFor({ state: 'hidden' });
  assert.equal(researchPosts, 0, 'archive retry must not spend research quota');
  assert.deepEqual(errors, []);
  console.log('PASS archive failure, malformed response, retry recovery, cached-story retention, no implicit demo or research, no page errors');
} finally {
  await browser.close();
}
