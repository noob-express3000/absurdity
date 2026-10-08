import Parser from "rss-parser";
import { ExaSearchProvider, type SearchHit, type SearchOptions } from "./providers/search";

export type DiscoveryOrigin = "exa" | "rss";

export type DiscoveredCandidate = {
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string;
  snippet?: string;
  localScore: number;
  origin?: DiscoveryOrigin;
};

export type DiscoveryResult = {
  scanned: number;
  unusualCandidates: number;
  candidates: DiscoveredCandidate[];
  failures: string[];
  note: string;
  providers?: string[];
  exaQueries?: number;
};

export const RESEARCH_FEEDS = [
  { publisher: "UPI Odd News", url: "https://rss.upi.com/news/odd_news.rss", oddNews: true },
  { publisher: "Guardian World", url: "https://www.theguardian.com/world/rss" },
  { publisher: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { publisher: "ABC News Australia", url: "https://www.abc.net.au/news/feed/51120/rss.xml" },
  { publisher: "NPR World", url: "https://feeds.npr.org/1004/rss.xml" },
];

export const EXA_DISCOVERY_LENSES = [
  {
    label: "local absurdities",
    query: "bizarre unbelievable but true local news incident unexpected situation residents officials real event",
  },
  {
    label: "animals where they should not be",
    query: "escaped animal enters store airport school house vehicle bizarre local news real event",
  },
  {
    label: "failed crimes and bizarre thefts",
    query: "bizarre failed robbery unusual thief theft strange crime local news real event",
  },
  {
    label: "bureaucracy and authority blunders",
    query: "bizarre government council police administrative error mix-up wrong person wrong address local news",
  },
  {
    label: "courts and lawsuits",
    query: "bizarre lawsuit unusual court case judge strange legal dispute local news real event",
  },
  {
    label: "transport chaos",
    query: "bizarre passenger luggage airport train bus road vehicle incident unexpected local news",
  },
  {
    label: "mistaken identity and accidents",
    query: "mistaken identity accidentally wrong house wrong person wrong address bizarre mix-up local news",
  },
  {
    label: "impossible discoveries",
    query: "strange discovery found inside wall luggage toilet vehicle house bizarre local news real event",
  },
  {
    label: "food competitions and records",
    query: "bizarre food competition unusual world record contest festival local news real event",
  },
  {
    label: "technology gone sideways",
    query: "robot drone AI machine glitch bizarre technology incident unexpected local news real event",
  },
  {
    label: "improbable coincidences and rescues",
    query: "extraordinary coincidence improbable rescue bizarre survival unexpected real event local news",
  },
  {
    label: "global regional oddities",
    query: "bizarre unbelievable local news Africa Asia Latin America Oceania Europe strange real event",
  },
] as const;

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

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function publisherFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Web result";
  }
}

function domainOf(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function mergeCandidates(primary: DiscoveredCandidate[], secondary: DiscoveredCandidate[]) {
  const merged = new Map<string, DiscoveredCandidate>();
  for (const candidate of [...primary, ...secondary]) {
    const key = normalizeUrl(candidate.url);
    if (!merged.has(key)) merged.set(key, candidate);
  }

  // Search engines can heavily favor one publisher. Keep the discovery pool broad
  // before event clustering and editorial analysis.
  const perDomain = new Map<string, number>();
  const diverse: DiscoveredCandidate[] = [];
  for (const candidate of merged.values()) {
    const domain = domainOf(candidate.url) || candidate.publisher;
    const count = perDomain.get(domain) || 0;
    if (count >= 3) continue;
    perDomain.set(domain, count + 1);
    diverse.push(candidate);
  }
  return diverse;
}

export async function runLightweightDiscovery(options: {
  parseFeed?: (url: string) => Promise<{ items: Parser.Item[] }>;
} = {}): Promise<DiscoveryResult> {
  const parser = new Parser({ timeout: 15000 });
  const candidates: DiscoveredCandidate[] = [];
  const failures: string[] = [];

  await Promise.all(
    RESEARCH_FEEDS.map(async (feed) => {
      try {
        const parsed = await (options.parseFeed ?? (url => parser.parseURL(url)))(feed.url);
        for (const item of parsed.items.slice(0, 60)) {
          if (!item.title || !item.link) continue;
          const url = normalizeUrl(item.link);
          if (!url) continue;
          const snippet = item.contentSnippet || item.content || "";
          candidates.push({
            title: item.title,
            url,
            publisher: feed.publisher,
            publishedAt: item.isoDate || item.pubDate,
            snippet: snippet.slice(0, 400),
            localScore: Math.max(scoreHeadlineLocally(item.title, snippet), "oddNews" in feed ? 12 : 0),
            origin: "rss",
          });
        }
      } catch {
        failures.push(feed.publisher);
      }
    }),
  );

  const deduped = Array.from(new Map(candidates.map((item) => [normalizeUrl(item.url), item])).values());
  deduped.sort((a, b) => b.localScore - a.localScore);

  return {
    scanned: deduped.length,
    unusualCandidates: deduped.filter((item) => item.localScore > 0).length,
    candidates: deduped,
    failures,
    providers: ["rss"],
    exaQueries: 0,
    note: "RSS collection and deterministic triage; the pipeline applies its date window and candidate cap after clustering.",
  };
}

export async function runDiscovery(options: {
  parseFeed?: (url: string) => Promise<{ items: Parser.Item[] }>;
  searchWeb?: (query: string, limit?: number, options?: SearchOptions) => Promise<SearchHit[]>;
  now?: Date;
  windowHours?: number;
  resultsPerQuery?: number;
} = {}): Promise<DiscoveryResult> {
  const rssPromise = runLightweightDiscovery({ parseFeed: options.parseFeed });
  const hasExa = Boolean(options.searchWeb || process.env.EXA_API_KEY);

  if (!hasExa) return rssPromise;

  const now = options.now ?? new Date();
  const windowHours = Math.max(24, options.windowHours ?? Number(process.env.RESEARCH_WINDOW_HOURS || 48));
  const startPublishedDate = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
  const endPublishedDate = now.toISOString();
  const resultsPerQuery = Math.max(3, Math.min(10, options.resultsPerQuery ?? Number(process.env.EXA_DISCOVERY_RESULTS_PER_QUERY || 8)));
  const exaProvider = options.searchWeb ? null : new ExaSearchProvider();
  const exa = options.searchWeb ?? exaProvider!.search.bind(exaProvider);
  const exaCandidates: DiscoveredCandidate[] = [];
  const exaFailures: string[] = [];
  let exaQueries = 0;

  for (const lens of EXA_DISCOVERY_LENSES) {
    try {
      exaQueries += 1;
      const results = await exa(lens.query, resultsPerQuery, {
        category: "news",
        moderation: true,
        startPublishedDate,
        endPublishedDate,
        objective: "Find factual, recent reporting of high-surprise real-world events with a concrete 'that cannot be real' hook. Prioritize absurd mix-ups, improbable situations, bizarre official incidents, animals in unexpected places, failed crimes, strange discoveries and unusual competitions. Prefer local or primary reporting and diverse publishers. Reject merely uncommon or mildly quirky human-interest stories, generic opinion, evergreen lists, fiction, satire and SEO roundups.",
      });
      for (const hit of results) {
        if (!hit?.url || !hit?.title) continue;
        const url = normalizeUrl(hit.url);
        if (!url) continue;
        const snippet = hit.text?.trim() || "";
        exaCandidates.push({
          title: hit.title,
          url,
          publisher: publisherFromUrl(hit.url),
          publishedAt: hit.publishedDate,
          snippet: snippet.slice(0, 500),
          // These results already came from targeted unusual-news searches; the
          // deterministic score remains useful but no longer acts as the gate.
          localScore: Math.max(14, scoreHeadlineLocally(hit.title, snippet)),
          origin: "exa",
        });
      }
    } catch {
      exaFailures.push("Exa discovery: " + lens.label);
    }
  }

  const rss = await rssPromise;
  const inWindow = (candidate: DiscoveredCandidate) => {
    if (!candidate.publishedAt) return true;
    const time = Date.parse(candidate.publishedAt);
    return !Number.isFinite(time) || (time >= Date.parse(startPublishedDate) && time <= now.getTime());
  };
  // Apply freshness before the per-publisher cap, so stale search results cannot
  // crowd out fresh Exa hits or the RSS fallback from the same publisher.
  const merged = mergeCandidates(exaCandidates.filter(inWindow), rss.candidates.filter(inWindow));
  merged.sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === "exa" ? -1 : 1;
    return b.localScore - a.localScore;
  });

  return {
    scanned: merged.length,
    unusualCandidates: merged.filter((item) => item.localScore > 0).length,
    candidates: merged,
    failures: [...exaFailures, ...rss.failures],
    providers: exaCandidates.length ? ["exa", "rss"] : ["rss"],
    exaQueries,
    note: exaCandidates.length
      ? "Exa is the primary freshness-bounded discovery layer; RSS adds secondary coverage and fallback candidates before clustering."
      : "Exa discovery returned no usable candidates; RSS supplied the fallback discovery pool.",
  };
}
