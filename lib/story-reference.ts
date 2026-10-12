import type { Story } from './types';

export type StoryReference = { query: string; read: boolean; mentioned: boolean; index?: number };
const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const normalize = (text: string) => text.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function parseStoryReference(raw: string): StoryReference | null {
  const text = raw.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/^please\s+/, '')
    .replace(/^(?:can|could|would) you (?:please )?/, '').replace(/\s+please$/, '');
  const command = text.match(/^(open|select|read|play|go to|take me to|navigate to|bring up|show|tell me about)\s+(.+?)(?:\s+and\s+read(?:\s+it|\s+aloud)?)?$/);
  if (!command) return null;
  let query = command[2];
  const read = /^(read|play)$/.test(command[1]) || /\band read\b/.test(text);
  const mentioned = query.match(/^(?:the )?(\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:st|nd|rd|th)? (?:one|story|article)(?: that)? (?:you (?:mentioned|named|listed)|from (?:that|the) (?:update|briefing|list))$/);
  if (mentioned) return { query: '', read, mentioned: true,
    index: /^\d+$/.test(mentioned[1]) ? Number(mentioned[1]) : ordinals.indexOf(mentioned[1]) + 1 };
  if (/^(?:it|that|that (?:one|story|article)|the (?:one|story|article) (?:you (?:mentioned|named)|from (?:that|the) (?:update|briefing)))$/.test(query)) {
    return { query: '', read, mentioned: true };
  }
  // View, date and ordinary current-article questions retain their own handlers.
  if (/^(?:this(?: story| article)?|this story aloud|more(?: about this(?: story| article)?)?|a current story|home|history|archive|(?:my )?favou?rites|(?:the )?(?:new|latest|recent) stories)$/.test(query) ||
      /\b(?:stories|daily|weekly|today|week|month|update|briefing|roundup)\b/.test(query)) return null;
  query = query.replace(/^(?:(?:the|that) )?(?:story|article|one) (?:about|on|with) /, '')
    .replace(/^(?:(?:the|that) )?(?:story|article) /, '').replace(/^(?:the|that) /, '')
    .replace(/ (?:story|article|one)$/, '');
  const normalized = normalize(query);
  if (!normalized || /^\d+$/.test(normalized) || ordinals.includes(normalized) || normalized === 'this') return null;
  return { query: normalized, read, mentioned: false };
}

export function matchStoryTitles(query: string, stories: Story[]): Story[] {
  const normalized = normalize(query);
  const exact = stories.filter(story => normalize(story.title) === normalized || normalize(story.shortTitle) === normalized);
  if (exact.length) return exact;
  const terms = normalized.split(' ').filter(term => !['the', 'a', 'an', 'about', 'in', 'on', 'of', 'and', 'with', 'to', 's'].includes(term));
  if (!terms.length) return [];
  return stories.filter(story => {
    const title = normalize(story.title).split(' ');
    return terms.every(term => title.includes(term));
  });
}

export function resolveStoryReference(reference: StoryReference, stories: Story[], mentioned: Story[]): Story[] {
  if (reference.mentioned) return reference.index === undefined ? mentioned : mentioned.slice(reference.index - 1, reference.index);
  const matches = matchStoryTitles(reference.query, mentioned);
  return matches.length ? matches : matchStoryTitles(reference.query, stories);
}
