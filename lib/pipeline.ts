import { createHash } from "node:crypto";
import type { DiscoveredCandidate } from "./research";
import { runDiscovery, type DiscoveryResult } from "./research";
import {
  type CandidateAnalysis,
  type CandidateEvidence,
  GroqIntelligenceProvider,
} from "./providers/intelligence";
import { getSearchProvider } from "./providers/search";
import { findSelectedStoryMatches, recordResearchRun, saveStories, saveStoryEvidence } from "./repository";
import { ingestSource, type PageLoader } from "./articles";
import { claimResearch, releaseResearch } from "./research-cycle";
import type { IngestedEvidence, Story, StorySource } from "./types";

type CandidateGroup = {
  candidates: DiscoveredCandidate[];
  primary: DiscoveredCandidate;
  clusterId: string;
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 20);
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function normalizedTitle(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|and|or|of|to|in|on|for|with|after|as|at|by)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleTokens(value: string) {
  return new Set(normalizedTitle(value).split(" ").filter((word) => word.length > 2));
}

function similarity(a: string, b: string) {
  const left = titleTokens(a);
  const right = titleTokens(b);
  if (!left.size || !right.size) return 0;

  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / new Set([...left, ...right]).size;
}

function clusterCandidates(candidates: DiscoveredCandidate[]) {
  const groups: CandidateGroup[] = [];

  for (const candidate of candidates) {
    const canonicalUrl = normalizeUrl(candidate.url);
    const duplicate = groups.find((group) =>
      group.candidates.some(
        (existing) =>
          normalizeUrl(existing.url) === canonicalUrl ||
          normalizedTitle(existing.title) === normalizedTitle(candidate.title) ||
          similarity(existing.title, candidate.title) >= 0.68,
      ),
    );

    if (duplicate) {
      duplicate.candidates.push(candidate);
      if (candidate.localScore > duplicate.primary.localScore) duplicate.primary = candidate;
      continue;
    }

    groups.push({
      candidates: [candidate],
      primary: candidate,
      clusterId: "cluster-" + hash(normalizedTitle(candidate.title)),
    });
  }

  return groups;
}

function publisherFromUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Search result";
  }
}

function currentClock() {
  return new Date().toISOString().slice(11, 16);
}

function basicCategory(title: string) {
  const text = title.toLowerCase();
  if (/animal|goat|emu|dog|cat|bear|bird|bat|crab/.test(text)) return "Animals";
  if (/robot|ai|app|computer|drone|technology/.test(text)) return "Technology";
  if (/airport|train|bus|road|traffic|plane/.test(text)) return "Transportation";
  if (/weather|storm|flood|sinkhole|earthquake/.test(text)) return "Weather / Nature";
  return "Uncategorized";
}

function deterministicAnalysis(
  primary: DiscoveredCandidate,
  discoveryEvidence: CandidateEvidence[],
): CandidateAnalysis {
  const summary = primary.snippet?.trim() || primary.title;
  const multiSource = new Set(discoveryEvidence.flatMap((item) => {
    try { return [new URL(item.url).hostname.replace(/^www\./, "")]; }
    catch { return []; }
  })).size > 1;

  return {
    selected: multiSource && primary.localScore >= 12,
    summary,
    detailedSummary: summary,
    whyItsWeird:
      "The story passed Absurdity's deterministic unusual-term filter, but no model-assisted editorial analysis was available.",
    category: basicCategory(primary.title),
    tags: [],
    country: "Unknown",
    region: "Unknown",
    eventDate: null,
    absurdityScore: Math.min(100, Math.max(primary.localScore, 35)),
    noveltyScore: Math.min(100, Math.max(primary.localScore, 30)),
    humorScore: 0,
    seriousnessScore: 25,
    credibilityScore: multiSource ? 60 : 35,
    confidence: multiSource ? "medium" : "low",
    seriousness: "mixed",
    verificationNotes: multiSource
      ? "Multiple discovery sources appear to report the same clustered event. Groq analysis was unavailable, so selection remains conservative."
      : "Single-source discovery only. Groq analysis was unavailable, so this candidate is retained for history but not promoted.",
    corroboratingUrls: discoveryEvidence.map((item) => item.url),
  };
}

function sourceTypeForPublisher(publisher: string): StorySource["sourceType"] {
  return /department|police|council|government|gov\.|university|authority/i.test(publisher)
    ? "institutional"
    : "national";
}

function makeStoryId(group: CandidateGroup) {
  const canonical = group.candidates
    .map((candidate) => normalizeUrl(candidate.url))
    .sort()[0];
  return "live-" + hash(canonical || normalizedTitle(group.primary.title));
}

type ResearchOptions = {
  discover?: (options?: { windowHours?: number }) => Promise<DiscoveryResult>;
  loadArticle?: PageLoader;
  runId?: string;
};

export async function runDailyResearch(options: ResearchOptions = {}) {
  const claim = options.runId ? { acquired: true, run: { id: options.runId } }
    : await claimResearch(false);
  if (!claim.acquired || !claim.run) return { skipped: true, run: claim.run };
  try {
    return await executeResearch({ ...options, runId: claim.run.id });
  } finally {
    await releaseResearch(claim.run.id);
  }
}

async function executeResearch(options: {
  discover?: (options?: { windowHours?: number }) => Promise<DiscoveryResult>;
  loadArticle?: PageLoader;
  runId: string;
}) {
  const startedAt = new Date();
  const runId = options.runId;
  const windowHours = Math.max(24, Number(process.env.RESEARCH_WINDOW_HOURS || 30));
  const maxCandidates = Math.max(1, Math.min(30, Number(process.env.RESEARCH_MAX_CANDIDATES || 12)));
  const windowStart = new Date(startedAt.getTime() - windowHours * 60 * 60 * 1000);
  const failures: string[] = [];
  const providerUsage = {
    rss: true,
    discoveryProvider: "rss",
    exaDiscoveryQueries: 0,
    searchProvider: "none",
    searchQueries: 0,
    groq: false,
    groqAnalyses: 0,
    articlesAttempted: 0,
    articlesExtracted: 0,
    articleFallbacks: 0,
    alreadySelected: 0,
  };

  await recordResearchRun({
    id: runId,
    startedAt: startedAt.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: startedAt.toISOString(),
    status: "running",
    scanned: 0,
    candidates: 0,
    selected: 0,
    failures,
    providerUsage,
  });

  try {
    const discovery = await (options.discover ?? runDiscovery)({ windowHours });
    providerUsage.discoveryProvider = discovery.providers?.includes("exa") ? "exa+rss" : "rss";
    providerUsage.exaDiscoveryQueries = discovery.exaQueries ?? 0;
    failures.push(...discovery.failures.map((failure) =>
      failure.startsWith("Exa discovery:") ? failure : "RSS: " + failure));
    if (discovery.scanned === 0 && discovery.failures.length) throw new Error("No news feeds could be fetched.");

    const inWindow = discovery.candidates.filter((candidate) => {
      if (!candidate.publishedAt) return true;
      const time = new Date(candidate.publishedAt).getTime();
      return Number.isFinite(time) ? time >= windowStart.getTime() && time <= Date.now() : true;
    });

    const clustered = clusterCandidates(inWindow.filter((candidate) => candidate.localScore > 0));
    const existing = await findSelectedStoryMatches(
      clustered.map(group => group.clusterId),
      clustered.flatMap(group => group.candidates.map(candidate => normalizeUrl(candidate.url))),
      windowStart.toISOString(),
    );
    const selectedClusters = new Set(existing.map(item => item.cluster_id));
    const selectedUrls = new Set(existing.map(item => item.url));
    const unseen = clustered.filter(group => !selectedClusters.has(group.clusterId) &&
      !group.candidates.some(candidate => selectedUrls.has(normalizeUrl(candidate.url))));
    providerUsage.alreadySelected = clustered.length - unseen.length;
    const groups = unseen
      .sort((a, b) => Number(b.candidates.some(candidate => candidate.origin === "exa")) -
        Number(a.candidates.some(candidate => candidate.origin === "exa")) ||
        b.primary.localScore - a.primary.localScore)
      .slice(0, maxCandidates);

    const searchProvider = getSearchProvider();
    if (searchProvider) {
      providerUsage.searchProvider = process.env.EXA_API_KEY ? "exa" : "tavily";
    }

    const intelligence = new GroqIntelligenceProvider();
    providerUsage.groq = intelligence.available();
    const stories: Story[] = [];
    const evidenceByStory = new Map<string, IngestedEvidence[]>();
    const articleCache = new Map<string, Promise<IngestedEvidence>>();

    for (const group of groups) {
      const primary = group.primary;
      const discoveryEvidence: CandidateEvidence[] = [primary, ...group.candidates.filter(candidate => candidate !== primary)].map((candidate) => ({
        publisher: candidate.publisher,
        title: candidate.title,
        url: normalizeUrl(candidate.url),
        text: candidate.snippet,
        kind: candidate.origin === "exa" ? "search" : "rss",
        publishedAt: candidate.publishedAt,
      }));

      let searchEvidence: CandidateEvidence[] = [];
      if (searchProvider) {
        try {
          providerUsage.searchQueries += 1;
          const primaryDomain = (() => { try { return new URL(primary.url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
          const hits = await searchProvider.search(primary.title, 5, {
            category: "news",
            moderation: true,
            excludeDomains: primaryDomain ? [primaryDomain] : undefined,
            objective: "Find independent reporting or primary-source corroboration of the exact same event. Prefer a different publisher from the discovered article.",
          });
          searchEvidence = hits.map((hit) => ({
            publisher: publisherFromUrl(hit.url),
            title: hit.title,
            url: normalizeUrl(hit.url),
            text: hit.text,
            kind: "search",
            publishedAt: hit.publishedDate,
          }));
        } catch (error) {
          failures.push(
            "Search: " + (error instanceof Error ? error.message : "provider request failed"),
          );
        }
      }

      const discoveredEvidence = [
        ...discoveryEvidence,
        ...searchEvidence.filter(
          (item) => !discoveryEvidence.some((source) => normalizeUrl(source.url) === normalizeUrl(item.url)),
        ),
      ];

      // Fetch only the strongest shortlist sources, once per URL in this run.
      const allEvidence: IngestedEvidence[] = await Promise.all(discoveredEvidence.map(async (source, index) => {
        if (index >= 3) {
          const text = source.text ?? '';
          return {...source, text, resolvedUrl:source.url, fetchedAt:startedAt.toISOString(),
            status:text ? 'excerpt' as const : 'unavailable' as const, method:source.kind === 'search' ? 'search' as const : 'rss' as const,
            originalLength:text.length, truncated:false, contentHash:createHash('sha256').update(text).digest('hex')};
        }
        let pending = articleCache.get(source.url);
        if (!pending) {
          providerUsage.articlesAttempted += 1;
          pending = ingestSource(source, options.loadArticle).then(item => {
            if (item.status === 'article') providerUsage.articlesExtracted += 1;
            else providerUsage.articleFallbacks += 1;
            return item;
          });
          articleCache.set(source.url, pending);
        }
        const retrieved = await pending;
        return {...retrieved, publisher:source.publisher, publishedAt:source.publishedAt ?? retrieved.publishedAt};
      }));
      const extracted = allEvidence.filter(item => item.status === 'article').length;
      for (const item of allEvidence) {
        if (item.error) failures.push('Article: ' + item.url + ': ' + item.error);
      }

      let analysis: CandidateAnalysis;
      if (intelligence.available()) {
        try {
          providerUsage.groqAnalyses += 1;
          analysis = await intelligence.analyzeCandidate({
            title: primary.title,
            snippet: primary.snippet,
            publisher: primary.publisher,
            publishedAt: primary.publishedAt,
            localScore: primary.localScore,
            evidence: allEvidence,
          });
        } catch (error) {
          failures.push(
            "Groq: " + (error instanceof Error ? error.message : "candidate analysis failed"),
          );
          analysis = deterministicAnalysis(primary, discoveryEvidence);
        }
      } else {
        analysis = deterministicAnalysis(primary, discoveryEvidence);
      }

      const corroborating = new Set([
        ...discoveryEvidence.map((item) => item.url),
        ...analysis.corroboratingUrls,
      ]);

      const sources: StorySource[] = allEvidence
        .filter((item) => corroborating.has(item.url))
        .map((item) => ({
          publisher: item.publisher,
          url: item.url,
          publishedAt: item.publishedAt || primary.publishedAt || startedAt.toISOString(),
          sourceType: discoveryEvidence.some((source) => source.url === item.url && source.kind === "rss")
            ? sourceTypeForPublisher(item.publisher)
            : "search",
        }));

      const uniqueSources = Array.from(new Map(sources.map((source) => [source.url, source])).values());
      const canPromote = analysis.selected && analysis.confidence !== "low";
      const publicationTime = primary.publishedAt ? Date.parse(primary.publishedAt) : NaN;
      const publicationDate = Number.isFinite(publicationTime) ? new Date(publicationTime).toISOString() : startedAt.toISOString();
      const eventDate = analysis.eventDate || publicationDate;
      const story: Story = {
        id: makeStoryId(group),
        rank: 0,
        title: primary.title,
        shortTitle:
          primary.title.length > 72 ? primary.title.slice(0, 69).trimEnd() + "…" : primary.title,
        summary: analysis.summary,
        detailedSummary: analysis.detailedSummary,
        whyItsWeird: analysis.whyItsWeird,
        category: analysis.category,
        tags: analysis.tags,
        country: analysis.country,
        region: analysis.region,
        eventDate,
        publicationDate,
        discoveredAt: startedAt.toISOString(),
        absurdityScore: analysis.absurdityScore,
        noveltyScore: analysis.noveltyScore,
        humorScore: analysis.humorScore,
        seriousnessScore: analysis.seriousnessScore,
        credibilityScore: analysis.credibilityScore,
        confidence: analysis.confidence,
        seriousness: analysis.seriousness,
        clusterId: group.clusterId,
        sources: uniqueSources,
        verificationNotes: analysis.verificationNotes,
        status: canPromote ? "selected" : analysis.confidence === "low" ? "candidate" : "verified",
        research: [
          {
            label: "Article extraction",
            detail: `${extracted} readable article body/bodies extracted; ${allEvidence.length - extracted} excerpt or unavailable source(s).`,
            status: extracted ? "complete" : "warning",
            at: currentClock(),
          },
          {
            label: "Discovered",
            detail:
              group.candidates.length +
              " discovery item" +
              (group.candidates.length === 1 ? "" : "s") +
              " grouped into this event cluster from " +
              Array.from(new Set(group.candidates.map(candidate => candidate.origin || "rss"))).join(" + ") +
              ".",
            status: "complete",
            at: currentClock(),
          },
          {
            label: "Corroboration search",
            detail: searchProvider
              ? searchEvidence.length + " optional search result(s) inspected."
              : "No search provider configured; discovery evidence only.",
            status: searchProvider ? "complete" : "warning",
            at: currentClock(),
          },
          {
            label: intelligence.available() ? "Model analysis" : "Deterministic analysis",
            detail: analysis.verificationNotes,
            status: analysis.confidence === "low" ? "warning" : "complete",
            at: currentClock(),
          },
          {
            label: canPromote ? "Selected" : "Retained",
            detail: canPromote
              ? "Promoted into the reader and permanent history."
              : "Stored for deduplication and audit, but not promoted into the reader.",
            status: canPromote ? "complete" : "warning",
            at: currentClock(),
          },
        ],
        isFixture: false,
      };

      stories.push(story);
      evidenceByStory.set(story.id, allEvidence);
    }

    const selected = stories
      .filter((story) => story.status === "selected")
      .sort((a, b) => b.absurdityScore - a.absurdityScore);

    selected.forEach((story, index) => {
      story.rank = index + 1;
    });

    await saveStories(stories);
    for (const story of stories) await saveStoryEvidence(story.id, evidenceByStory.get(story.id) ?? []);

    const completedAt = new Date();
    await recordResearchRun({
      id: runId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: startedAt.toISOString(),
      status: "complete",
      scanned: discovery.scanned,
      candidates: stories.length,
      selected: selected.length,
      failures,
      providerUsage,
    });

    return {
      runId,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      scanned: discovery.scanned,
      candidates: stories.length,
      selected: selected.length,
      failures,
      providerUsage,
    };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Unknown research failure");
    await recordResearchRun({
      id: runId,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      windowStart: windowStart.toISOString(),
      windowEnd: startedAt.toISOString(),
      status: "failed",
      scanned: 0,
      candidates: 0,
      selected: 0,
      failures,
      providerUsage,
    });
    throw error;
  }
}
