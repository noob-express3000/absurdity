import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNavigation } from '../lib/navigation';
import { DemoStoryRepository } from '../lib/repository';
import { demoBriefing } from '../lib/demo-data';
const clock = Math.max(...demoBriefing.stories.map(story => Date.parse(story.publicationDate)));

test('navigation distinguishes opening favorites, saving, and explicitly searching the archive', () => {
  assert.deepEqual(parseNavigation('show my favorites', 'home', clock), {action:'view',view:'favorites'});
  assert.deepEqual(parseNavigation('save this story', 'home', clock), {action:'favorite'});
  assert.equal(parseNavigation('find stories about next generation robots', 'home', clock).action,'search');
  assert.equal(parseNavigation('anything interesting', 'home', clock).action,'unknown');
  assert.deepEqual(parseNavigation('stop listening', 'home', clock),{action:'stop-listening'});
});
test('requested search combines geography, category, and publication-date bounds', async () => {
  const instruction = parseNavigation('find South African animal stories', 'home', clock);
  assert.equal(instruction.action,'search');
  if (instruction.action !== 'search') return;
  assert.equal(instruction.query,'south africa animal');
  const matches = await new DemoStoryRepository().searchStories(instruction.query);
  assert.ok(matches.length);
  assert.ok(matches.every(story=>story.country==='South Africa'));
  const olderClock = clock + 3 * 86400000;
  const older = parseNavigation('show older animal stories', 'home', olderClock);
  assert.equal(older.action,'search');
  if (older.action !== 'search') return;
  const results = await new DemoStoryRepository().searchStories(older.query,500,older);
  assert.ok(results.length);
  assert.ok(results.every(story=>Date.parse(story.publicationDate)<olderClock-2*86400000));
});
test('exact dates use Johannesburg publication days and invalid dates are rejected', () => {
  assert.deepEqual(parseNavigation('find animal stories on 2026-10-01','history',clock),{
    action:'search',view:'history',query:'animal',from:'2026-09-30T22:00:00.000Z',before:'2026-10-01T22:00:00.000Z',
  });
  assert.equal(parseNavigation('find stories on 2026-02-30','history',clock).action,'unknown');
  const lastWeek = parseNavigation('find stories from the last week','home',clock);
  assert.equal(lastWeek.action,'search');
  if(lastWeek.action==='search') assert.equal(Date.parse(lastWeek.from!),clock-7*86400000);
});
