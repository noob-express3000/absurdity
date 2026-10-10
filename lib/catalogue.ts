import type { Story } from "./types";
import type { StoryView } from "./navigation";

export const CATALOGUE_PAGE_SIZE = 8;
export type CatalogueScope = StoryView | "all" | "current";
export type CatalogueCommand =
  | { action: "list"; scope: CatalogueScope; page: "next" | "previous" | number; countOnly: boolean }
  | { action: "select"; index: number; read: boolean };

const ordinals = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

export function parseCatalogueCommand(raw: string): CatalogueCommand | null {
  const text = raw.toLowerCase().trim().replace(/[.!?]+$/, "").replace(/^please\s+/, "")
    .replace(/^(?:can|could|would) you (?:please )?/, "").replace(/\s+(?:please|for me)$/, "");
  const select = text.match(/^(?:(open|select|read|play|show|go to|tell me about)\s+)?(?:the\s+)?(?:story\s+)?(?:number\s+)?(\d+|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)(?:st|nd|rd|th)?(?:\s+(?:story|one))?(?:\s+and\s+read(?:\s+it)?)?$/);
  if (select) {
    const index = /^\d+$/.test(select[2]) ? Number(select[2]) : ordinals.indexOf(select[2]) + 1;
    if (Number.isSafeInteger(index) && index >= 1 && index <= 500) {
      return { action: "select", index, read: /\b(?:read|play)\b/.test(text) };
    }
  }
  if (/^(?:list|enumerate)(?: (?:them|these|those))?$/.test(text)) {
    return { action: "list", scope: "current", page: 0, countOnly: false };
  }
  if (/^(?:next|previous) (?:page|batch)(?: of stories)?$/.test(text) || /^(?:list|show|enumerate) (?:more|the next)(?: stories)?$/.test(text)) {
    return { action: "list", scope: "current", page: text.startsWith("previous") ? "previous" : "next", countOnly: false };
  }
  const list = /^(?:(?:list|enumerate)(?:\s+(?:all|every|the|these|those|my|available|saved|current|home|older|archived|favorite|favourite|history|new|recent|in|on))*\s*(?:stories|story|news|favorites|favourites|archive|history)?|(?:what|which) stories (?:are (?:there|available)|do (?:you|we|i) have)|(?:show|give) me (?:a |the )?(?:list|catalogue|catalog|story list)(?: of (?:all |available |saved )?stories)?|show all stories)(?: in (?:my |the )?(?:home|history|archive|favorites|favourites))?$/;
  const count = /^how many (?:(?:all|available|saved|current|home|older|archived|favorite|favourite|new|recent) )?stories(?: (?:are there|are available|do (?:you|we|i) have))?(?: in (?:my )?(?:home|history|archive|favorites|favourites))?$/;
  if (!list.test(text) && !count.test(text)) return null;
  const scope: CatalogueScope = /\bfavou?rites?\b/.test(text) ? "favorites"
    : /\b(?:older|history)\b/.test(text) ? "history"
    : /\b(?:home|current|new|recent)\b/.test(text) ? "home"
    : /\b(?:all|every|available|saved|archive|archived)\b/.test(text) || /do (?:you|we|i) have/.test(text) ? "all" : "current";
  return { action: "list", scope, page: 0, countOnly: count.test(text) };
}

export function catalogueText(stories: Story[], label: string, page = 0, countOnly = false) {
  const count = stories.length;
  if (!count) return `There are no stories ${label}.`;
  const start = Math.min(Math.max(0, page) * CATALOGUE_PAGE_SIZE,
    Math.floor((count - 1) / CATALOGUE_PAGE_SIZE) * CATALOGUE_PAGE_SIZE);
  const prefix = `There ${count === 1 ? "is" : "are"} ${count}${count === 500 ? " or more" : ""} ${count === 1 ? "story" : "stories"} ${label}.`;
  if (countOnly) return prefix;
  const titles = stories.slice(start, start + CATALOGUE_PAGE_SIZE)
    .map((story, index) => `${start + index + 1}. ${story.title}`).join("\n");
  return `${prefix}\n${titles}${start + CATALOGUE_PAGE_SIZE < count ? '\nSay “next page” for more.' : ""}`;
}
