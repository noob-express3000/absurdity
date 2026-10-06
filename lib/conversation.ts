import type { StoryView } from './navigation';

export const conversationActions = ['none', 'view', 'next', 'previous', 'select', 'favorite', 'unfavorite', 'dismiss', 'read', 'search', 'refresh'] as const;
export type ConversationAction = typeof conversationActions[number];
export type ConversationTurn = { role: 'user' | 'assistant'; content: string };
export type ConversationPlan = {
  text: string;
  action: ConversationAction;
  view: StoryView | null;
  storyId: string | null;
  query: string | null;
  from: string | null;
  before: string | null;
  read: boolean;
};
export const conversationSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    action: { type: 'string', enum: conversationActions },
    view: { type: ['string', 'null'], enum: ['home', 'favorites', 'history', null] },
    storyId: { type: ['string', 'null'] },
    query: { type: ['string', 'null'] },
    from: { type: ['string', 'null'] },
    before: { type: ['string', 'null'] },
    read: { type: 'boolean' },
  },
  required: ['text', 'action', 'view', 'storyId', 'query', 'from', 'before', 'read'],
  additionalProperties: false,
};

export function validateConversationPlan(value: unknown, allowedIds: Set<string>): ConversationPlan {
  const plan = value as ConversationPlan;
  if (!plan || typeof plan !== 'object' || !conversationActions.includes(plan.action) ||
      typeof plan.text !== 'string' || !plan.text.trim() || plan.text.length > 3000 || typeof plan.read !== 'boolean') throw new Error('Invalid conversation plan.');
  if (plan.view !== null && !['home', 'favorites', 'history'].includes(plan.view)) throw new Error('Invalid view.');
  if (plan.storyId !== null && (typeof plan.storyId !== 'string' || !allowedIds.has(plan.storyId))) throw new Error('Unknown story.');
  if (plan.action === 'select' && !plan.storyId) throw new Error('Selection requires a stored story.');
  if (plan.action === 'view' && !plan.view) throw new Error('View required.');
  if (plan.query !== null && (typeof plan.query !== 'string' || plan.query.length > 200)) throw new Error('Invalid archive query.');
  for (const date of [plan.from, plan.before]) {
    if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)))) throw new Error('Invalid date bounds.');
  }
  if (plan.from && plan.before && Date.parse(plan.from) >= Date.parse(plan.before)) throw new Error('Inverted date bounds.');
  if (plan.action === 'search' && plan.view !== 'history' && plan.view !== 'favorites') throw new Error('Search must use a stored archive view.');
  return { ...plan, text: plan.text.trim(), from: plan.from ? new Date(plan.from).toISOString() : null, before: plan.before ? new Date(plan.before).toISOString() : null };
}
