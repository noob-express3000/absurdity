import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH
  ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
const screenshotDir = process.env.QA_SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

try {
  const request = await browser.newContext();
  const seed = (await (await request.request.get(base + '/api/stories?scope=all')).json()).stories[0];
  await request.close();
  const stories = Array.from({ length: 40 }, (_, index) => ({ ...seed, id: 'phone-' + index,
    title: index ? `Story ${index + 1}: ${seed.title}` : seed.title,
    publicationDate: new Date(Date.now() - 1000).toISOString(), isFixture: false,
    detailedSummary: [seed.detailedSummary, seed.detailedSummary].join('\n\n'),
  }));
  const errors = [];
  let researchPosts = 0;

  for (const viewport of [{ width: 320, height: 568 }, { width: 360, height: 640 },
    { width: 393, height: 700 }, { width: 414, height: 896 }]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/stories?*', route => route.fulfill({ json: { mode: 'live', stories } }));
    await page.route('**/api/research*', route => {
      if (route.request().method() === 'POST') researchPosts++;
      return route.fulfill({ json: { run: null } });
    });
    await page.route('**/api/narrate', route => route.fulfill({ status: 503, json: {} }));
    await page.addInitScript(() => {
      window.speechSynthesis.speak = utterance => queueMicrotask(() => utterance.onend?.());
      window.speechSynthesis.cancel = () => {};
    });
    await page.goto(base);
    await page.getByRole('heading', { name: stories[0].title, exact: true }).waitFor();
    const browse = page.getByRole('button', { name: 'Browse stories', exact: true });
    assert.equal(await browse.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.locator('.story-list').isVisible(), false);
    assert.ok((await page.locator('.reader-body').boundingBox()).height > viewport.height * .45);
    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute('content');
    assert.match(viewportMeta, /interactive-widget=resizes-content/);

    // Scroll width alone misses clipped controls: check each real tap target.
    for (const button of [...await page.locator('nav button').all(),
      page.getByRole('button', { name: 'Previous story', exact: true }),
      page.getByRole('button', { name: 'Next story', exact: true }),
      page.getByRole('button', { name: 'Type to Absurdity', exact: true }),
      page.getByRole('button', { name: 'Read aloud', exact: true }),
      page.getByRole('button', { name: 'Talk to Absurdity', exact: true })]) {
      const box = await button.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        JSON.stringify({ viewport, label: await button.getAttribute('aria-label'), box }));
      assert.ok(box.height >= 44, JSON.stringify(box));
    }
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/phone-${viewport.width}.png` });

    await page.getByRole('button', { name: 'Next story', exact: true }).click();
    assert.equal(await page.locator('article h2').innerText(), stories[1].title);
    assert.match(await browse.innerText(), /2 \/ 40/);
    await browse.click();
    assert.equal(await page.locator('.story-list').isVisible(), true);
    if (screenshotDir) await page.screenshot({ path: `${screenshotDir}/picker-${viewport.width}.png` });
    await page.getByRole('button', { name: stories[16].title, exact: true }).click();
    assert.equal(await page.locator('article h2').innerText(), stories[16].title);
    assert.equal(await page.locator('.story-list').isVisible(), false);
    assert.equal(await browse.evaluate(element => element === document.activeElement), true);
    assert.match(await browse.innerText(), /17 \/ 40/);

    await browse.click();
    const selectedRow = page.locator('.story-row.is-selected');
    await selectedRow.getByRole('button', { name: 'Favorite story', exact: true }).click();
    await page.getByRole('button', { name: 'Favorites', exact: true }).click();
    assert.equal(await page.locator('.story-list').isVisible(), false);
    assert.equal(await page.locator('article h2').innerText(), stories[16].title);
    await browse.click();
    await page.getByRole('button', { name: 'Close story list', exact: true }).press('Escape');
    assert.equal(await page.locator('.story-list').isVisible(), false);
    assert.equal(await browse.evaluate(element => element === document.activeElement), true);

    await page.locator('nav').getByRole('button', { name: 'Home', exact: true }).click();
    await browse.click();
    await page.locator('.story-row.is-selected').getByRole('button', { name: 'Dismiss story', exact: true }).click();
    assert.equal(await page.locator('.story-row').count(), 39);
    await page.getByRole('button', { name: 'Restore dismissed (1)', exact: true }).click();
    assert.equal(await page.locator('.story-row').count(), 40);

    // Simulate the reduced content viewport left above an Android keyboard.
    await page.setViewportSize({ width: viewport.width, height: 360 });
    await browse.click();
    await page.getByRole('button', { name: 'Type to Absurdity', exact: true }).click();
    await page.locator('.story-list').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.story-list').isVisible(), false);
    const input = page.getByRole('textbox', { name: 'Ask Absurdity to navigate', exact: true });
    const box = await input.boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 360, JSON.stringify(box));
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await input.fill('enumerate stories');
    await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
    await page.locator('.agent-prompt p').getByText('There are 40 stories in home.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
    await browse.click();
    assert.equal(await input.isVisible(), false);
    await page.getByRole('button', { name: 'Close story list', exact: true }).click();
    await page.getByRole('button', { name: 'Type to Absurdity', exact: true }).click();
    await page.getByRole('button', { name: 'Close instruction box', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    assert.equal(await page.locator('.story-list').isVisible(), true);
    assert.equal(await browse.isVisible(), false);
    const sidebar = await page.locator('.story-sidebar').boundingBox();
    const article = await page.locator('.story-reader').boundingBox();
    assert.ok(sidebar.x + sidebar.width <= article.x + 1);
    await context.close();
  }
  assert.equal(researchPosts, 0);
  assert.deepEqual(errors, []);
  console.log('PASS 320/360/393/414px phone layouts, every navigation/control tap target, collapsed story picker, story 17 selection, favorites, dismissal/restore, keyboard-height typing, Escape/focus, desktop restoration, no research calls or page errors');
} finally { await browser.close(); }
