import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH
  ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const seed = (await (await page.request.get(base + '/api/stories?scope=all')).json()).stories[0];
  const stories = Array.from({ length: 40 }, (_, index) => ({ ...seed, id: `edge-${index + 1}`,
    title: `Catalogue story ${index + 1}`, publicationDate: new Date(Date.now() - 1000).toISOString(),
    detailedSummary: Array.from({ length: 12 }, () => seed.detailedSummary).join('\n\n'), isFixture: false }));
  let archive = stories;
  let malformed = false;
  let chats = 0;
  let refreshes = 0;
  let narration = 'fallback';
  await page.addInitScript(() => {
    window.qaSaid = [];
    window.qaCancelled = 0;
    window.speechSynthesis.speak = utterance => { window.qaSaid.push(utterance.text); window.qaUtterance = utterance; };
    window.speechSynthesis.cancel = () => { window.qaCancelled++; };
    class Recognition {
      start() { window.qaRecognition = this; }
      stop() { queueMicrotask(() => this.onend?.()); }
    }
    window.SpeechRecognition = Recognition;
    window.qaAudioMode = 'success';
    window.Audio = class {
      constructor() { window.qaAudio = this; }
      pause() { this.paused = true; }
      async play() {
        if (window.qaAudioMode === 'double-error') {
          this.onerror?.();
          throw new Error('Playback rejected');
        }
      }
    };
  });
  await page.route('**/api/stories?*', route => route.fulfill({ json: {
    mode: 'live', stories: malformed ? [{ id: 'broken', sources: null }] : archive,
  } }));
  await page.route('**/api/research*', route => {
    if (route.request().method() === 'POST') refreshes++;
    return route.fulfill({ json: { run: null } });
  });
  await page.route('**/api/narrate', async route => {
    if (narration === 'delayed') {
      await new Promise(resolve => setTimeout(resolve, 250));
      await route.fulfill({ status: 503, json: {} }).catch(() => {});
    } else if (narration === 'audio') {
      await route.fulfill({ contentType: 'audio/mpeg', body: Buffer.from([73, 68, 51, 1]) });
    } else await route.fulfill({ status: 503, json: {} });
  });
  await page.route('**/api/chat', async route => {
    chats++;
    const message = route.request().postDataJSON().message;
    if (message.includes('thinking test')) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const action = { text: 'Grounded reply.', action: 'none', view: null, storyId: null, query: null, from: null, before: null, read: false };
      return route.fulfill({ json: { text: action.text, action, provider: 'groq', mode: 'live' } }).catch(() => {});
    }
    const matches = stories.filter((_, index) => index % 2 === 0);
    const action = { text: `I found ${matches.length} matching stories.`, action: 'search', view: 'home', storyId: matches[0].id,
      query: 'animal', from: null, before: null, read: false };
    return route.fulfill({ json: { text: action.text, action, stories: matches, provider: 'deterministic', mode: 'live' } });
  });
  await page.goto(base);
  await page.getByRole('heading', { name: stories[0].title, exact: true }).waitFor();
  await page.getByRole('button', { name: 'Type to Absurdity' }).click();
  const input = page.getByRole('textbox', { name: 'Ask Absurdity to navigate' });
  assert.equal(await input.evaluate(element => element === document.activeElement), true);
  assert.equal(await page.getByRole('button', { name: 'Send instruction' }).isDisabled(), true);
  const say = async text => {
    await input.fill(text);
    await page.getByRole('button', { name: 'Send instruction' }).click();
  };
  await say('enumerate stories');
  await page.locator('.agent-prompt p').getByText('There are 40 stories in home.', { exact: false }).waitFor();
  assert.match(await page.locator('.agent-prompt p').innerText(), /8\. Catalogue story 8/);
  await say('next page');
  assert.match(await page.locator('.agent-prompt p').innerText(), /9\. Catalogue story 9/);
  await say('next page');
  assert.match(await page.locator('.agent-prompt p').innerText(), /17\. Catalogue story 17/);
  await say('open story 17');
  await page.getByRole('heading', { name: stories[16].title, exact: true }).waitFor();
  assert.equal(chats, 0, 'enumeration, paging and number selection must not call a model');
  await say('how many stories are available');
  assert.equal(await page.locator('.agent-prompt p').innerText(), 'There are 40 stories in the saved archive.');
  await say('open 99');
  assert.match(await page.locator('.agent-prompt p').innerText(), /isn't a story numbered 99/);
  assert.equal(await page.locator('article h2').innerText(), stories[16].title);

  await say('find animal stories');
  await page.waitForFunction(() => document.querySelectorAll('.story-row').length === 20);
  await page.waitForFunction(() => document.querySelector('.agent-prompt p')?.textContent.includes('1. Catalogue story 1'));
  await say('open story 13');
  await page.getByRole('heading', { name: stories[24].title, exact: true }).waitFor();
  assert.equal(chats, 1, 'selecting a search result beyond 12 must stay local');

  await page.locator('.reader-body').evaluate(element => { element.scrollTop = element.scrollHeight; });
  assert.ok(await page.locator('.reader-body').evaluate(element => element.scrollTop) > 0);
  await page.getByRole('button', { name: 'Next story', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.reader-body').scrollTop === 0);
  assert.equal(await page.evaluate(() => document.scrollingElement.scrollTop), 0);

  // Clearing favorites during narration must stop the article that disappears.
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await page.locator('.story-row.is-selected').getByRole('button', { name: 'Favorite story' }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await page.getByRole('button', { name: 'Stop reading' }).waitFor();
  await page.getByRole('button', { name: 'Remove favorite' }).click();
  await page.getByRole('button', { name: 'Read aloud' }).waitFor();
  assert.equal(await page.locator('.story-heading').count(), 0);
  assert.ok(await page.evaluate(() => window.qaCancelled) > 0);
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();

  // Cancelling preparation aborts the network request and prevents late fallback.
  narration = 'delayed';
  const failed = page.waitForEvent('requestfailed', { predicate: request => request.url().endsWith('/api/narrate') });
  const beforeCancel = await page.evaluate(() => window.qaSaid.length);
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await page.getByRole('button', { name: 'Preparing…' }).click();
  await failed;
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.qaSaid.length), beforeCancel);

  // Both media error pathways can fire for one audio file: speak fallback once.
  narration = 'audio';
  await page.evaluate(() => { window.qaAudioMode = 'double-error'; });
  const beforeFallback = await page.evaluate(() => window.qaSaid.length);
  await page.getByRole('button', { name: 'Read aloud' }).click();
  await page.waitForFunction(count => window.qaSaid.length === count + 1, beforeFallback);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.qaSaid.length), beforeFallback + 1);
  await page.getByRole('button', { name: 'Stop reading' }).click();

  narration = 'fallback';
  await page.getByRole('button', { name: 'Talk to Absurdity' }).click();
  await say('thinking test');
  await page.getByRole('button', { name: 'Stop response' }).waitFor();
  const titleBefore = await page.locator('article h2').innerText();
  await page.evaluate(() => window.qaRecognition.onresult({ results: [[{ transcript: 'next' }]] }));
  assert.equal(await page.locator('article h2').innerText(), titleBefore, 'recognition must ignore input while thinking');
  await page.getByRole('button', { name: 'Stop response' }).click();
  await page.getByRole('button', { name: 'Stop listening' }).click();
  await page.waitForTimeout(250);

  // A passive sync must preserve a selected old History story and reject corrupt rows.
  const old = { ...stories[0], id: 'old-history', title: 'Selected old History story', publicationDate: '2020-01-01T00:00:00.000Z' };
  const sync = async () => {
    const response = page.waitForResponse(response => response.url().includes('/api/stories?'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await response;
  };
  archive = [...stories, old];
  await sync();
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.getByRole('heading', { name: old.title, exact: true }).waitFor();
  await sync();
  assert.equal(await page.locator('article h2').innerText(), old.title);
  malformed = true;
  await sync();
  assert.equal(await page.locator('article h2').innerText(), old.title);

  await page.setViewportSize({ width: 360, height: 640 });
  await say('enumerate all stories');
  const inputBox = await input.boundingBox();
  assert.ok(inputBox.y >= 0 && inputBox.y + inputBox.height <= 640);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
  assert.equal(refreshes, 0, 'search, enumeration and navigation must not trigger discovery');
  assert.deepEqual(errors, []);
  console.log('PASS 40-story enumeration/counts, paging, stable numbered search selection beyond 12, scroll reset, focus, favorite-removal cancellation, aborted narration, one fallback per audio error, thinking echo suppression, selected History preservation, malformed rows, bounded mobile replies, zero discovery/model calls for catalogue commands');
} finally { await browser.close(); }
