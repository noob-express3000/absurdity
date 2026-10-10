import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readerRequest, isReaderStory, isSourceUrl } from '../lib/reader-request';
import { demoBriefing } from '../lib/demo-data';

test('reader deadlines cover stalled response bodies and release after successful requests', async () => {
  const original = globalThis.fetch;
  try {
    let signal: AbortSignal;
    globalThis.fetch = async (_url, init) => {
      signal = init!.signal!;
      return Response.json({ stories: [] });
    };
    await assert.rejects(readerRequest('/archive', {}, () => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }), 10), { name: 'TimeoutError' });
    await readerRequest('/archive', {}, response => response.json(), 10);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(signal!.aborted, false, 'a completed request must not retain its deadline');
  } finally { globalThis.fetch = original; }
});

test('reader requests forward stop/cancellation without depending on AbortSignal.any', async () => {
  const original = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async (_url, init) => {
      controller.abort();
      assert.equal(init!.signal!.aborted, true);
      throw init!.signal!.reason;
    };
    await assert.rejects(readerRequest('/narrate', { signal: controller.signal }, response => response.json()));
  } finally { globalThis.fetch = original; }
});

test('corrupt archive rows cannot crash the reader and source links only allow HTTP(S)', () => {
  const valid = demoBriefing.stories[0];
  assert.equal(isReaderStory(valid), true);
  for (const value of [null, {}, { ...valid, detailedSummary: null }, { ...valid, sources: null },
    { ...valid, sources: [{ url: null, publisher: 'Broken' }] }]) assert.equal(isReaderStory(value), false);
  for (const url of ['https://example.org/article', 'http://example.org/article']) assert.equal(isSourceUrl(url), true);
  for (const url of ['javascript:alert(1)', 'data:text/html,bad', '/relative', 'not a URL']) assert.equal(isSourceUrl(url), false);
});
