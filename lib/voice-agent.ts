import { answerFromCorpus } from './agent';
import type { ConversationPlan, ConversationTurn } from './conversation';
import { demoBriefing } from './demo-data';
import { parseNavigation, type StoryView } from './navigation';
import { GroqIntelligenceProvider } from './providers/intelligence';
import { DemoStoryRepository, storyRepository } from './repository';
import type { Story } from './types';
import { clampHistoryBefore, clampHomeFrom } from './story-lifecycle';

export type VoiceContext = {
  message: string;
  storyId?: string;
  scope: StoryView;
  visibleIds: string[];
  history: ConversationTurn[];
  displayMode?: 'demo' | 'live';
};
export type VoiceReply = {
  text: string;
  provider: 'groq' | 'deterministic' | 'safe-fallback';
  intent: string;
  action: ConversationPlan;
  mode: 'demo' | 'live';
  stories?: Story[];
};

function noAction(text: string): ConversationPlan {
  return { text, action: 'none', view: null, storyId: null, query: null, from: null, before: null, read: false };
}

export async function replyToVoice(context: VoiceContext): Promise<VoiceReply> {
  if (parseNavigation(context.message, context.scope, Date.now()).action === 'refresh') {
    const text = 'Starting a story fetch. I will keep the reader open while it runs.';
    return { text, action: { ...noAction(text), action: 'refresh' },
      provider: 'deterministic', intent: 'refresh',
      mode: context.displayMode ?? (process.env.ABSURDITY_MODE === 'live' ? 'live' : 'demo') };
  }
  // The client explicitly identifies fixtures it is displaying when the live archive is empty.
  const repository = context.displayMode === 'demo' ? new DemoStoryRepository() : storyRepository;
  const briefing = await repository.getCurrentBriefing();
  const mode = briefing.mode;
  const selected = context.storyId ? await repository.getStory(context.storyId) : null;
  const current = selected?.status === 'selected' ? selected : null;

  // Keep the model focused on what the user can actually see. Archive search
  // itself still runs against Turso after the model has interpreted the query,
  // so no stored stories are discarded or made unreachable.
  const known = new Map(briefing.stories.map(story => [story.id, story]));
  if (current) known.set(current.id, current);
  const missingIds = context.visibleIds.filter(id => !known.has(id));
  const fetchedVisible = await Promise.all(missingIds.map(id => repository.getStory(id)));
  for (const story of fetchedVisible) {
    if (story?.status === 'selected') known.set(story.id, story);
  }
  const visible = context.visibleIds
    .map(id => known.get(id))
    .filter((story): story is Story => Boolean(story && story.status === 'selected'));
  const corpus = [
    ...(current ? [current] : []),
    ...visible.filter(story => story.id !== current?.id),
  ].slice(0, 25);
  const clock = mode === 'demo' ? Math.max(...demoBriefing.stories.map(story => Date.parse(story.publicationDate))) : Date.now();
  const provider = new GroqIntelligenceProvider();
  let plan: ConversationPlan;
  let usedProvider: VoiceReply['provider'] = 'groq';
  let reason = provider.available() ? 'Groq is temporarily unavailable.' : 'Groq conversation is not configured yet.';
  try {
    if (!provider.available()) throw new Error('Groq is not configured.');
    plan = await provider.planConversation(context.message, corpus, {
      storyId: current?.id, scope: context.scope, visibleIds: context.visibleIds, history: context.history, now: new Date(clock).toISOString(), mode,
    });
    if (plan.action === 'refresh') throw new Error('Refresh requires an explicit refresh request.');
  } catch (error) {
    // Never substitute demo claims for a live conversation when a provider fails.
    console.warn('Voice conversation using grounded fallback:', error instanceof Error ? error.message : 'Provider failed');
    usedProvider = mode === 'demo' ? 'deterministic' : 'safe-fallback';
    const instruction = parseNavigation(context.message, context.scope, clock);
    if (instruction.action === 'search') {
      plan = { ...noAction('Searching the saved archive.'), action: 'search', view: instruction.view, query: instruction.query, from: instruction.from ?? null, before: instruction.before ?? null };
    } else if (instruction.action === 'view') {
      plan = { ...noAction(`Opening ${instruction.view}.`), action: 'view', view: instruction.view };
    } else if (['next', 'previous', 'favorite', 'dismiss', 'read'].includes(instruction.action)) {
      plan = { ...noAction('Okay.'), action: instruction.action as ConversationPlan['action'] };
    } else if (mode === 'demo') {
      const answer = answerFromCorpus(context.message, current?.id);
      plan = noAction(`${reason} ${answer.text}`);
      if (answer.storyId && answer.storyId !== current?.id && corpus.some(story => story.id === answer.storyId)) {
        plan = { ...plan, action: 'select', storyId: answer.storyId };
      }
    } else {
      plan = noAction(`${reason} You can still use next, read, favorites, history, and explicit archive searches.`);
    }
  }

  if (plan.action === 'search') {
    const targetView = plan.view ?? context.scope;
    const dates = {
      from: plan.from ?? undefined,
      before: plan.before ?? undefined,
    };
    if (targetView === 'history') dates.before = clampHistoryBefore(dates.before, clock);
    if (targetView === 'home') dates.from = clampHomeFrom(dates.from, clock);
    const matches = await repository.searchStories(plan.query ?? '', 500, dates);
    // Favorites are private browser state; the client applies that final filter.
    const text = plan.view === 'favorites'
      ? 'I found matching saved stories. I will show the ones you have favorited.'
      : matches.length ? `I found ${matches.length}${matches.length === 500 ? ' or more' : ''} ${mode === 'demo' ? 'demo ' : ''}${matches.length === 1 ? 'story' : 'stories'} in the archive. ${matches[0].title}.` : 'No saved stories match that request.';
    return { text, action: { ...plan, text, storyId: matches[0]?.id ?? null }, stories: matches, mode, provider: usedProvider, intent: 'archive-search' };
  }
  const text = mode === 'demo' && usedProvider === 'groq' && plan.action === 'none' ? `In this demo: ${plan.text}` : plan.text;
  return { text, action: { ...plan, text }, mode, provider: usedProvider, intent: 'conversation' };
}
