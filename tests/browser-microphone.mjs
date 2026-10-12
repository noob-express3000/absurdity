import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROMIUM_PATH
  ? { executablePath: process.env.QA_CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } });
  const errors = [];
  let chats = 0, narrations = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.qaSessions = [];
    window.qaSaid = [];
    class Recognition {
      constructor() { this.starts = 0; this.aborts = 0; this.stops = 0; window.qaSessions.push(this); }
      start() {
        this.starts++; this.recording = true; window.qaRecognition = this;
        if (window.qaStartThrows) throw new Error('Recognition startup interrupted');
        if (!window.qaDelayStart) this.onstart?.();
      }
      stop() { this.stops++; this.recording = false; queueMicrotask(() => this.onend?.()); }
      abort() {
        this.aborts++;
        if (window.qaAbortThrows) throw new Error('Recognition already stopping');
        this.recording = false;
        queueMicrotask(() => this.onend?.());
      }
      finishDelayedStart() { this.recording = true; this.onstart?.(); }
    }
    window.SpeechRecognition = Recognition;
    window.speechSynthesis.speak = utterance => { window.qaSaid.push(utterance.text); window.qaUtterance = utterance; };
    window.speechSynthesis.cancel = () => {};
  });
  await page.route('**/api/research*', route => route.fulfill({ json: { run: null } }));
  await page.route('**/api/narrate', route => { narrations++; return route.fulfill({ status: 503, json: {} }); });
  await page.route('**/api/chat', async route => {
    chats++;
    await new Promise(resolve => setTimeout(resolve, 150));
    const action = { text: 'Mocked story answer.', action: 'none', view: null, storyId: null,
      query: null, from: null, before: null, read: false, references: [] };
    return route.fulfill({ json: { text: action.text, action, provider: 'groq', mode: 'demo' } });
  });
  await page.goto(base);
  await page.locator('article h2').waitFor();
  const start = page.getByRole('button', { name: 'Talk to Absurdity', exact: true });
  const stop = page.getByRole('button', { name: 'Stop listening', exact: true });
  const session = () => page.evaluate(() => window.qaSessions.map(s => ({ starts: s.starts, aborts: s.aborts, stops: s.stops, recording: s.recording })));
  const assertOff = async () => {
    await start.waitFor();
    assert.ok((await session()).every(s => !s.recording), 'every microphone session must be off');
  };
  const command = async message => page.evaluate(message => window.qaRecognition.onresult?.({ results: [[{ transcript: message }]] }), message);

  // Two clicks in one event turn must not leave an orphan microphone.
  await start.evaluate(button => { button.click(); button.click(); });
  assert.equal((await session()).length, 1);
  await page.evaluate(() => { window.qaLateResult = window.qaRecognition.onresult; window.qaLateEnd = window.qaRecognition.onend; });
  const title = await page.locator('article h2').innerText();
  await stop.click();
  await assertOff();
  assert.equal((await session())[0].aborts, 1);
  await page.evaluate(() => { window.qaLateResult({ results: [[{ transcript: 'next' }]] }); window.qaLateEnd(); });
  assert.equal(await page.locator('article h2').innerText(), title, 'late stopped-session speech cannot execute navigation');

  for (const message of ['stop listening', 'could you stop recording please', 'turn off the microphone']) {
    await start.click();
    await command(message);
    await assertOff();
  }
  assert.equal(chats, 0, 'microphone controls must never ask a model');
  assert.equal(narrations, 0, 'microphone controls must never request narration');

  // A late native start event must be aborted even after the UI has stopped.
  await page.evaluate(() => { window.qaDelayStart = true; });
  await start.click();
  await stop.click();
  await page.evaluate(() => window.qaRecognition.finishDelayedStart());
  await assertOff();
  await page.evaluate(() => { window.qaDelayStart = false; });

  // Old callbacks cannot interfere with a newly owned session.
  await start.click();
  const before = await session();
  await page.evaluate(() => { window.qaLateResult({ results: [[{ transcript: 'next' }]] }); window.qaLateEnd(); });
  assert.equal(await page.locator('article h2').innerText(), title);
  assert.deepEqual(await session(), before);

  // Stopping while an answer is pending must prevent recording from resuming.
  await page.getByRole('button', { name: 'Type to Absurdity', exact: true }).click();
  await page.getByRole('textbox', { name: 'Ask Absurdity to navigate' }).fill('Why is this weird?');
  await page.getByRole('button', { name: 'Send instruction', exact: true }).click();
  await page.getByRole('button', { name: 'Stop response', exact: true }).waitFor();
  await stop.click();
  await page.waitForFunction(() => window.qaSaid.includes('Mocked story answer.'));
  const startsBeforeEnd = (await session()).reduce((count, s) => count + s.starts, 0);
  await page.evaluate(() => window.qaUtterance.onend());
  await assertOff();
  assert.equal((await session()).reduce((count, s) => count + s.starts, 0), startsBeforeEnd);

  // Startup and abort failures still release ownership and allow a new session.
  await page.evaluate(() => { window.qaStartThrows = true; });
  await start.click();
  await assertOff();
  await page.evaluate(() => { window.qaStartThrows = false; window.qaAbortThrows = true; });
  await start.click();
  await stop.click();
  await assertOff();
  await page.evaluate(() => { window.qaAbortThrows = false; });
  await start.click();
  await page.evaluate(() => window.qaRecognition.onerror({ error: 'not-allowed' }));
  await assertOff();
  await start.click();
  await stop.click();
  await assertOff();
  assert.deepEqual(errors, []);
  console.log('PASS immediate microphone abort, rapid double-start guard, spoken stop aliases without provider calls, stale results/end events, delayed native start, new-session ownership, stop during pending answer, no resume after playback, startup/abort errors, permission failure and restart; mocked audio only');
} finally { await browser.close(); }
