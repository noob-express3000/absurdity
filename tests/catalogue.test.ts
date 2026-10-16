import assert from 'node:assert/strict';
import { test } from 'node:test';
import { catalogueText, parseCatalogueCommand } from '../lib/catalogue';
import { demoBriefing } from '../lib/demo-data';

test('listing/counting use explicit catalogue commands without confusing topic searches or refresh', () => {
  for (const text of ['enumerate stories', 'list stories', 'list them', 'which stories do you have', 'what stories are available', 'show all stories',
    'could you enumerate the stories please', 'list every story', 'list all stories in the archive']) {
    assert.equal(parseCatalogueCommand(text)?.action, 'list', text);
  }
  assert.deepEqual(parseCatalogueCommand('how many stories are available'), { action: 'list', scope: 'all', page: 0, countOnly: true });
  assert.equal(parseCatalogueCommand('list my favorites')?.action, 'list');
  for (const text of ['list animal stories', 'what stories do you have about animals', 'refresh the stories', 'what happened in the third story?']) {
    assert.equal(parseCatalogueCommand(text), null, text);
  }
});

test('numbered story selection and pagination have stable absolute indices', () => {
  for (const text of ['open story 3', 'open story number 3', 'select the third story', '3', 'tell me about the third one']) {
    assert.deepEqual(parseCatalogueCommand(text), { action: 'select', index: 3, read: false }, text);
  }
  assert.deepEqual(parseCatalogueCommand('read the second story'), { action: 'select', index: 2, read: true });
  assert.deepEqual(parseCatalogueCommand('open 3 and read it'), { action: 'select', index: 3, read: true });
  assert.deepEqual(parseCatalogueCommand('next page'), { action: 'list', scope: 'current', page: 'next', countOnly: false });
  assert.equal(parseCatalogueCommand('open 0'), null);
  assert.deepEqual(parseCatalogueCommand('open 501'), { action: 'select', index: 501, read: false });
});

test('catalogue counts the entire result set and enumerates beyond the old 12-story model cap', () => {
  const stories = Array.from({ length: 60 }, (_, index) => ({ ...demoBriefing.stories[0], id: String(index), title: `Result ${index + 1}` }));
  assert.match(catalogueText(stories, 'in Home'), /60 stories/);
  assert.match(catalogueText(stories, 'in Home'), /8\. Result 8/);
  assert.doesNotMatch(catalogueText(stories, 'in Home'), /9\. Result 9/);
  assert.match(catalogueText(stories, 'in Home', 2), /17\. Result 17/);
  assert.match(catalogueText(stories, 'in Home', 99), /60\. Result 60/);
  assert.doesNotMatch(catalogueText(stories, 'in Home', 99), /next page/);
  assert.equal(catalogueText(stories, 'in Home', 0, true), 'There are 60 stories in Home.');
  assert.equal(catalogueText([], 'in History'), 'There are no stories in History.');
});


test('remote pagination presents full counts without requiring all stories in memory', () => {
  const stories = Array.from({ length: 80 }, (_, index) => ({
    ...demoBriefing.stories[0], id: String(index), title: `Archived story ${index + 1}`,
  }));
  assert.match(catalogueText(stories, 'in the saved archive', 0, true, 623), /623 stories/);
  assert.match(catalogueText(stories, 'in the saved archive', 9, false, 623), /80\. Archived story 80/);
  assert.match(catalogueText(stories, 'in the saved archive', 9, false, 623), /next page/);
});
