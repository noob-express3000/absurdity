import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH
  ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
try {
  const real = await browser.newPage();
  const archive = (await (await real.request.get(base + '/api/stories?scope=all')).json()).stories;
  const seed = archive[0];
  console.log('Checking real update requests and voice follow-ups');
  const prepare = async page => {
    await page.addInitScript(() => {
      window.qaSaid = [];
      window.speechSynthesis.speak = utterance => { window.qaSaid.push(utterance.text); queueMicrotask(() => utterance.onend?.()); };
      window.speechSynthesis.cancel = () => {};
      class Recognition { start() { window.qaRecognition = this; } stop() { queueMicrotask(() => this.onend?.()); } }
      window.SpeechRecognition = Recognition;
    });
    await page.route('**/api/narrate', route => route.fulfill({ status: 503, json: {} }));
    await page.route('**/api/research*', route => route.fulfill({ json: { run: null } }));
  };
  await prepare(real);
  await real.goto(base);
  await real.locator('article h2').waitFor();
  await real.getByRole('button', { name: 'Talk to Absurdity', exact: true }).click();
  const voice = async (page, message) => {
    await page.waitForFunction(() => window.qaRecognition && document.querySelector('.voice-indicator')?.textContent === 'Listening');
    await page.evaluate(message => window.qaRecognition.onresult({ results: [[{ transcript: message }]] }), message);
  };
  // This first sequence uses the real chat route and real demo repository.
  for (const message of ['give me a weekly update', 'give me a daily update', 'what are the new stories']) {
    const response = real.waitForResponse(response => response.url().endsWith('/api/chat'));
    await voice(real, message);
    const result = await (await response).json();
    assert.equal(result.action.action, 'search');
    await real.waitForFunction(title => document.querySelector('article h2')?.textContent === title, result.stories[0].title);
    await real.waitForFunction(() => window.qaSaid.length > 0 && document.querySelector('.voice-indicator')?.textContent === 'Listening');
    await voice(real, 'open the second one you mentioned');
    await real.getByRole('heading', { name: result.stories[1].title, exact: true }).waitFor();
    await voice(real, 'read the second one you mentioned');
    await real.waitForFunction(title => window.qaSaid.at(-1)?.includes(title), result.stories[1].title);
    assert.match(await real.locator('nav button[aria-current]').innerText(), /Home/);
  }
  await real.close();

  for (const viewport of [{ width: 1280, height: 720 }, { width: 360, height: 640 }]) {
    console.log(`Checking ${viewport.width}px story references`);
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(page);
    const stories = Array.from({ length: 40 }, (_, index) => ({ ...seed, id: `update-${index + 1}`,
      title: `Animal ${index + 1} escapes from airport baggage claim`, shortTitle: `Airport animal ${index + 1}`,
      publicationDate: new Date(Date.now() - 1000).toISOString(), isFixture: false }));
    const external = { ...seed, id: 'delivered-history-reference', title: 'Raccoon steals a municipal inspection drone',
      shortTitle: 'The inspection raccoon', publicationDate: '2020-01-01T00:00:00Z', isFixture: false };
    let chats = 0, posts = 0;
    await page.route('**/api/stories?*', route => route.fulfill({ json: { mode: 'live', stories } }));
    await page.route('**/api/research*', route => {
      if (route.request().method() === 'POST') posts++;
      return route.fulfill({ json: { run: null } });
    });
    await page.route('**/api/chat', route => {
      chats++;
      const body = route.request().postDataJSON();
      const action = { text: 'I found 40 matching stories.', action: 'search', view: 'home', storyId: stories[0].id,
        query: '', from: null, before: null, read: false, references: [] };
      let returned = stories;
      if (body.message === 'which story stood out') {
        action.text = stories[32].title; action.action = 'none'; action.view = null; action.storyId = null;
        action.references = [stories[32].id]; returned = [stories[32]];
      } else if (body.message === 'compare those stories') {
        assert.deepEqual(body.referenceIds, [stories[32].id]);
        action.text = external.title + '\n' + stories[32].title; action.action = 'none'; action.view = null; action.storyId = null;
        action.references = [external.id, stories[32].id]; returned = [external, stories[32]];
      }
      return route.fulfill({ json: { text: action.text, action, stories: returned, provider: 'groq', mode: 'live' } });
    });
    await page.goto(base);
    await page.getByRole('heading', { name: stories[0].title, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Type to Absurdity', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Ask Absurdity to navigate', exact: true });
    const say = async message => {
      const count = await page.evaluate(() => window.qaSaid.length);
      await input.fill(message);
      await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
      await page.waitForFunction(count => window.qaSaid.length > count, count);
    };
    await say('give me a weekly update');
    assert.equal(await page.locator('.story-row').count(), 40);
    await say('open the animal 33 story');
    assert.equal(await page.locator('article h2').innerText(), stories[32].title);
    assert.equal(chats, 1, 'named selection beyond the context limit must stay local');
    await say('next page');
    await say('open the first one you mentioned');
    assert.equal(await page.locator('article h2').innerText(), stories[8].title, 'reference ordinals follow the spoken page');
    await say('open story 33');
    assert.equal(await page.locator('article h2').innerText(), stories[32].title, 'catalogue numbers stay absolute');
    await say('which story stood out');
    await say('read the story you mentioned');
    assert.ok((await page.evaluate(() => window.qaSaid.at(-1))).includes(stories[32].detailedSummary));
    await say('compare those stories');
    const before = await page.locator('article h2').innerText();
    await say('open that story');
    assert.match(await page.locator('.agent-prompt p').innerText(), /Which story do you mean/);
    assert.equal(await page.locator('article h2').innerText(), before, 'ambiguous references cannot navigate arbitrarily');
    await say('open the first one you mentioned');
    assert.equal(await page.locator('article h2').innerText(), external.title, 'a returned reference absent from the initial archive is reachable');
    assert.equal(await page.locator('nav button[aria-current]').innerText(), 'History');
    await say('open the animal 33 story');
    assert.equal(await page.locator('nav button[aria-current]').innerText(), 'Home');
    await say('give me a daily update');
    await say('read the third one you mentioned');
    assert.equal(await page.locator('article h2').innerText(), stories[2].title);
    await say('what are the new stories');
    await say('open story 17');
    assert.equal(await page.locator('article h2').innerText(), stories[16].title);
    assert.equal(posts, 0, 'updates and follow-up navigation cannot launch research');
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('PASS real weekly/daily/new-story update → referenced selection → narration; 40-story title and numbered selection; spoken-page ordering; model references; delivered History article; ambiguous-reference clarification; desktop and phone; no discovery');
} finally { await browser.close(); }
