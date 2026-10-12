import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoBriefing } from '../lib/demo-data';
import { matchStoryTitles, parseStoryReference, resolveStoryReference } from '../lib/story-reference';

const stories = Array.from({ length: 40 }, (_, index) => ({ ...demoBriefing.stories[0], id: `reference-${index}`,
  title: `Animal ${index + 1} escapes from the airport`, shortTitle: `Airport animal ${index + 1}` }));

test('title selection reaches saved stories outside the model context and preserves read intent', () => {
  const reference = parseStoryReference('Could you open the story about animal 33 and read it please?')!;
  assert.equal(reference.read, true);
  assert.deepEqual(resolveStoryReference(reference, stories, stories.slice(0, 8)).map(story => story.id), [stories[32].id]);
  assert.deepEqual(matchStoryTitles(stories[32].title, stories), [stories[32]]);
  assert.deepEqual(matchStoryTitles(stories[32].shortTitle, stories), [stories[32]]);
  assert.deepEqual(resolveStoryReference(parseStoryReference('take me to that animal 33 story')!, stories, []), [stories[32]]);
});

test('references use the spoken reply order rather than archive order or the selected article', () => {
  const mentioned = [stories[32], stories[16]];
  assert.deepEqual(resolveStoryReference(parseStoryReference('open the second one you mentioned')!, stories, mentioned), [stories[16]]);
  assert.deepEqual(resolveStoryReference(parseStoryReference('read the story you mentioned')!, stories, [stories[32]]), [stories[32]]);
  assert.deepEqual(resolveStoryReference(parseStoryReference('open that story')!, stories, mentioned), mentioned);
  assert.deepEqual(resolveStoryReference(parseStoryReference('open the third one you mentioned')!, stories, mentioned), []);
});

test('ambiguous titles remain choices and ordinary questions, views and updates keep their handlers', () => {
  assert.equal(matchStoryTitles('animal', stories).length, 40);
  for (const message of ['tell me more about this story', 'read this story', 'open story 17', 'open a current story',
    'show new stories', 'give me a weekly update', 'show older animal stories', 'show my favorites']) {
    assert.equal(parseStoryReference(message), null, message);
  }
});
