import Parser from "rss-parser";

export type DiscoveredCandidate = {
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  snippet?: string;
  localScore: number;
};

const FEEDS = [
  { publisher: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { publisher: "ABC News Australia", url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
  { publisher: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
];

const unusualTerms = [
  "escaped",
  "goat",
  "emu",
  "robot",
  "mystery",
  "strange",
  "unusual",
  "accidentally",
  "mistaken",
  "unexpected",
  "rare",
  "wild",
  "chaos",
  "stuck",
  "surprise",
  "bizarre",
];

export function scoreHeadlineLocally(title: string, snippet = "") {
  const haystack = (title + " " + snippet).toLowerCase();
  let score = 0;
  for (const term of unusualTerms) {
    if (haystack.includes(term)) score += 12;
  }
  if (/\b(police|officials|scientists|airport|animal|robot|weather)\b/i.test(haystack)) score += 4;
  return Math.min(score, 100);
}

export async function runLightweightDiscovery() {
  const parser = new Parser({ timeout: 15000 });
  const candidates: DiscoveredCandidate[] = [];
  const failures: string[] = [];

  await Promise.all(
    FEEDS.map(async (feed) => {
      try {
        const parsed = await parser.parseURL(feed.url);
        for (const item of parsed.items.slice(0, 35)) {
          if (!item.title || !item.link) continue;
          const snippet = item.contentSnippet || item.content || "";
          candidates.push({
            title: item.title,
            url: item.link,
            publisher: feed.publisher,
            publishedAt: item.isoDate || item.pubDate,
            snippet: snippet.slice(0, 400),
            localScore: scoreHeadlineLocally(item.title, snippet),
          });
        }
      } catch {
        failures.push(feed.publisher);
      }
    }),
  );

  const deduped = Array.from(new Map(candidates.map((item) => [item.url, item])).values());
  deduped.sort((a, b) => b.localScore - a.localScore);

  return {
    scanned: deduped.length,
    unusualCandidates: deduped.filter((item) => item.localScore > 0).length,
    candidates: deduped.slice(0, 15),
    failures,
    note: "This endpoint performs lightweight RSS collection and deterministic triage only. Deep AI research is intentionally separate.",
  };
}
