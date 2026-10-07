import { HOME_WINDOW_MS } from "./story-lifecycle";

export type StoryView = "home" | "favorites" | "history";
export type NavigationRequest =
  | { action: "next" | "previous" | "favorite" | "dismiss" | "read" | "stop" | "stop-listening" | "refresh" }
  | { action: "view"; view: StoryView }
  | { action: "search"; query: string; view: StoryView; from?: string; before?: string }
  | { action: "unknown" };

// Archive navigation stays local; only an explicit refresh request launches research.
export function parseNavigation(raw: string, currentView: StoryView, now: number): NavigationRequest {
  const command = raw.toLowerCase().trim().replace(/[.!?]+$/, "").replace(/^please\s+/, "");
  const refresh = command.replace(/^(?:can|could|would) you (?:please )?/, "")
    .replace(/^please\s+/, "").replace(/\s+(?:please|again|now)$/, "");
  if (/^(?:refresh|reload)$/.test(refresh) ||
      /^(?:refresh|reload|update|fetch|retrieve|get|check for) (?:me )?(?:(?:the|my|our|some|more|new|latest|fresh|current|all) )*(?:stories|news|feed|briefing)$/.test(refresh)) return { action: "refresh" };
  if (/^(?:go to |open |show |show my |my )?(?:favorites|favourites)$/.test(command)) return { action: "view", view: "favorites" };
  if (/^(?:go to |open |show )?(?:history|archive|all stories)$/.test(command)) return { action: "view", view: "history" };
  if (/^(?:go to |open |show )?(?:home|new stories)$/.test(command)) return { action: "view", view: "home" };
  if (/^(?:next|next story)$/.test(command)) return { action: "next" };
  if (/^(?:previous|previous story|back|go back)$/.test(command)) return { action: "previous" };
  if (/^(?:favorite|favourite|save)(?: this(?: story)?)?$/.test(command)) return { action: "favorite" };
  if (/^(?:dismiss|skip)(?: this(?: story)?)?$/.test(command)) return { action: "dismiss" };
  if (/^(?:read|speak|read aloud|read this(?: story)?)$/.test(command)) return { action: "read" };
  if (command === "stop listening") return { action: "stop-listening" };
  if (/^(?:stop|stop reading)$/.test(command)) return { action: "stop" };
  if (!/^(?:find|search|show|look for)\b/.test(command)) return { action: "unknown" };

  let query = command.replace(/^(?:find|search|show|look for)\s*/, "");
  const view = /\b(?:favorites|favourites)\b/.test(query) ? "favorites" : "history";
  let from: string | undefined;
  let before: string | undefined;
  const exactDate = query.match(/\b(?:on|from)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (exactDate) {
    // Publication-date requests use the user's Johannesburg calendar day.
    const start = Date.parse(exactDate[1] + "T00:00:00+02:00");
    if (!Number.isFinite(start) || new Date(start + 2 * 3600000).toISOString().slice(0, 10) !== exactDate[1]) return { action: "unknown" };
    from = new Date(start).toISOString();
    before = new Date(start + 86400000).toISOString();
    query = query.replace(exactDate[0], " ");
  }
  const period = query.match(/\b(?:last|past)\s+(?:(\d+)\s+days?|week|month)\b/);
  if (period) {
    const days = period[1] ? Number(period[1]) : period[0].includes("week") ? 7 : 30;
    if (days < 1 || days > 36500) return { action: "unknown" };
    from = new Date(now - days * 86400000).toISOString();
    before = new Date(now + 1).toISOString();
    query = query.replace(period[0], " ");
  }
  if (/\bolder\b/.test(query)) {
    before = new Date(now - HOME_WINDOW_MS).toISOString();
    query = query.replace(/\bolder\b/g, " ");
  }
  query = query.replace(/\bsouth african\b/g, "south africa")
    .replace(/\banimals\b/g, "animal")
    .replace(/\b(?:the|my|me|for|in|about|from|on|of|stories|story|news|history|archive|favorites|favourites)\b/g, " ")
    .replace(/\s+/g, " ").trim();
  // "Search" alone is not a request to start discovering new stories.
  if (!query && !from && !before) return { action: "view", view: currentView };
  return { action: "search", query, view, from, before };
}
