import { createHash, randomUUID } from "node:crypto";
import type { DiscoveredCandidate } from "./research";
import { runLightweightDiscovery } from "./research";
import {
  type CandidateAnalysis,
  type CandidateEvidence,
  GroqIntelligenceProvider,
} from "./providers/intelligence";
import { getSearchProvider } from "./providers/search";
import { recordResearchRun, saveStories } from "./repository";
import type { Story, StorySource } from "./types";

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
  rssEvidence: CandidateEvidence[],
): CandidateAnalysis {
  const summary = primary.snippet?.trim() || primary.title;
  const multiSource = new Set(rssEvidence.map((item) => item.publisher)).size > 1;

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
      ? "Multiple RSS publishers appear to report the same clustered event. Groq analysis was unavailable, so selection remains conservative."
      : "Single-source RSS discovery only. Groq analysis was unavailable, so this candidate is retained for history but not promoted.",
    corroboratingUrls: rssEvidence.map((item) => item.url),
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

export async function runDailyResearch() {
  const startedAt = new Date();
  const runId = randomUUID();
  const windowHours = Math.max(24, Number(process.env.RESEARCH_WINDOW_HOURS || 30));
  const maxCandidates = Math.max(1, Math.min(30, Number(process.env.RESEARCH_MAX_CANDIDATES || 12)));
  const windowStart = new Date(startedAt.getTime() - windowHours * 60 * 60 * 1000);
  const failures: string[] = [];
  const providerUsage = {
    rss: true,
    searchProvider: "none",
    searchQueries: 0,
    openai: false,
    openaiAnalyses: 0,
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
    const discovery = await runLightweightDiscovery();
    failures.push(...discovery.failures.map((publisher) => "RSS: " + publisher));

    const inWindow = discovery.candidates.filter((candidate) => {
      if (!candidate.publishedAt) return true;
      const time = new Date(candidate.publishedAt).getTime();
      return Number.isFinite(time) ? time >= windowStart.getTime() : true;
    });

    const groups = clusterCandidates(inWindow.filter((candidate) => candidate.localScore > 0))
      .sort((a, b) => b.primary.localScore - a.primary.localScore)
      .slice(0, maxCandidates);

    const searchProvider = getSearchProvider();
    if (searchProvider) {
      providerUsage.searchProvider = process.env.EXA_API_KEY ? "exa" : "tavily";
    }

    const intelligence = new GroqIntelligenceProvider();
    providerUsage.openai = intelligence.available();
    const stories: Story[] = [];

    for (const group of groups) {
      const primary = group.primary;
      const rssEvidence: CandidateEvidence[] = group.candidates.map((candidate) => ({
        publisher: candidate.publisher,
        title: candidate.title,
        url: normalizeUrl(candidate.url),
        text: candidate.snippet,
        publishedAt: candidate.publishedAt,
      }));

      let searchEvidence: CandidateEvidence[] = [];
      if (searchProvider) {
        try {
          providerUsage.searchQueries += 1;
          const hits = await searchProvider.search(primary.title, 5);
          searchEvidence = hits.map((hit) => ({
            publisher: publisherFromUrl(hit.url),
            title: hit.title,
            url: normalizeUrl(hit.url),
            text: hit.text,
          }));
        } catch (error) {
          failures.push(
            "Search: " + (error instanceof Error ? error.message : "provider request failed"),
          );
        }
      }

      const allEvidence = [
        ...rssEvidence,
        ...searchEvidence.filter(
          (item) => !rssEvidence.some((source) => normalizeUrl(source.url) === normalizeUrl(item.url)),
        ),
      ];

      let analysis: CandidateAnalysis;
      if (intelligence.available()) {
        try {
          providerUsage.openaiAnalyses += 1;
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
          analysis = deterministicAnalysis(primary, rssEvidence);
        }
      } else {
        analysis = deterministicAnalysis(primary, rssEvidence);
      }

      const corroborating = new Set([
        ...rssEvidence.map((item) => item.url),
        ...analysis.corroboratingUrls,
      ]);

      const sources: StorySource[] = allEvidence
        .filter((item) => corroborating.has(item.url))
        .map((item) => ({
          publisher: item.publisher,
          url: item.url,
          publishedAt: item.publishedAt || primary.publishedAt || startedAt.toISOString(),
          sourceType: rssEvidence.some((source) => source.url === item.url)
            ? sourceTypeForPublisher(item.publisher)
            : "search",
        }));

      const uniqueSources = Array.from(new Map(sources.map((source) => [source.url, source])).values());
      const canPromote = analysis.selected && analysis.confidence !== "low";
      const publicationDate = primary.publishedAt || startedAt.toISOString();
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
            label: "Discovered",
            detail:
              group.candidates.length +
              " RSS item" +
              (group.candidates.length === 1 ? "" : "s") +
              " grouped into this event cluster.",
            status: "complete",
            at: currentClock(),
          },
          {
            label: "Corroboration search",
            detail: searchProvider
              ? searchEvidence.length + " optional search result(s) inspected."
              : "No paid search provider configured; RSS evidence only.",
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
    }

    const selected = stories
      .filter((story) => story.status === "selected")
      .sort((a, b) => b.absurdityScore - a.absurdityScore);

    selected.forEach((story, index) => {
      story.rank = index + 1;
    });

    await saveStories(stories);

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
