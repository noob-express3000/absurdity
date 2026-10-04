import type { Story } from "../types";

export type CandidateEvidence = {
  publisher: string;
  title: string;
  url: string;
  text?: string;
  publishedAt?: string;
};

export type ResearchCandidateContext = {
  title: string;
  snippet?: string;
  publisher: string;
  publishedAt?: string;
  localScore: number;
  evidence: CandidateEvidence[];
};

export type CandidateAnalysis = {
  selected: boolean;
  summary: string;
  detailedSummary: string;
  whyItsWeird: string;
  category: string;
  tags: string[];
  country: string;
  region: string;
  eventDate: string | null;
  absurdityScore: number;
  noveltyScore: number;
  humorScore: number;
  seriousnessScore: number;
  credibilityScore: number;
  confidence: Story["confidence"];
  seriousness: Story["seriousness"];
  verificationNotes: string;
  corroboratingUrls: string[];
};

export interface IntelligenceProvider {
  converse(message: string, stories: Story[], currentStoryId?: string): Promise<string>;
}

function extractResponseText(payload: any): string | null {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of parts) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const chunk of content) {
      if (typeof chunk?.text === "string") return chunk.text;
    }
  }
  return null;
}

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("OpenAI returned no JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

function score(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : fallback;
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export class OpenAIIntelligenceProvider implements IntelligenceProvider {
  constructor(
    private apiKey = process.env.OPENAI_API_KEY,
    private model = process.env.OPENAI_MODEL || "gpt-5-mini",
  ) {}

  available() {
    return Boolean(this.apiKey);
  }

  private async respond(input: string, maxOutputTokens: number) {
    if (!this.apiKey) throw new Error("OpenAI is not configured.");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + this.apiKey,
      },
      body: JSON.stringify({
        model: this.model,
        max_output_tokens: maxOutputTokens,
        input,
      }),
    });

    if (!response.ok) {
      throw new Error("OpenAI request failed with status " + response.status);
    }

    const payload = await response.json();
    const text = extractResponseText(payload);
    if (!text) throw new Error("OpenAI returned no text.");
    return text.trim();
  }

  async converse(message: string, stories: Story[], currentStoryId?: string) {
    const compactCorpus = stories.map((story) => ({
      id: story.id,
      rank: story.rank,
      title: story.title,
      summary: story.summary,
      whyItsWeird: story.whyItsWeird,
      country: story.country,
      region: story.region,
      category: story.category,
      eventDate: story.eventDate,
      publicationDate: story.publicationDate,
      confidence: story.confidence,
      seriousness: story.seriousness,
      verificationNotes: story.verificationNotes,
      sources: story.sources,
      isFixture: story.isFixture,
    }));

    return this.respond(
      "You are Absurdity, an editorial briefing agent. Answer ONLY from the provided researched corpus. Never turn a seeded fixture into a live claim. Keep serious stories serious. If the corpus does not support the answer, say so. Current story id: " +
        (currentStoryId || "none") +
        "\n\nCORPUS:\n" +
        JSON.stringify(compactCorpus) +
        "\n\nUSER:\n" +
        message,
      450,
    );
  }

  async analyzeCandidate(context: ResearchCandidateContext): Promise<CandidateAnalysis> {
    const evidence = context.evidence.map((item) => ({
      publisher: item.publisher,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      text: item.text?.slice(0, 1600),
    }));

    const raw = await this.respond(
      `You are the verification and classification stage for Absurdity, a global strange-news reader.

Use ONLY the supplied evidence. Do not invent facts, locations, dates, sources, motives, injuries, quotes or outcomes. Search results are only corroboration if they clearly describe the same underlying event. A strange headline by itself is not enough to claim verification.

Return exactly one JSON object and no markdown with these keys:
selected (boolean),
summary (string),
detailedSummary (string),
whyItsWeird (string),
category (string),
tags (array of short strings),
country (string; "Unknown" if unsupported),
region (string; "Unknown" if unsupported),
eventDate (ISO string or null),
absurdityScore (0-100),
noveltyScore (0-100),
humorScore (0-100),
seriousnessScore (0-100),
credibilityScore (0-100),
confidence ("high"|"medium"|"low"),
seriousness ("harmless"|"mixed"|"serious"),
verificationNotes (string),
corroboratingUrls (array containing only URLs from EVIDENCE that clearly report the same event).

Selection policy:
- select genuinely unusual or absurd real-world events worth preserving in a strange-news archive;
- require factual support rather than merely funny wording;
- keep serious incidents serious and set humorScore low or zero when humor would be inappropriate;
- use low confidence when evidence is thin or ambiguous;
- be conservative about country and eventDate;
- concise original summaries only; never reproduce article prose.

CANDIDATE:
${JSON.stringify({
        title: context.title,
        snippet: context.snippet?.slice(0, 1200),
        publisher: context.publisher,
        publishedAt: context.publishedAt,
        localScore: context.localScore,
      })}

EVIDENCE:
${JSON.stringify(evidence)}`,
      900,
    );

    const parsed = extractJson(raw);
    const allowedUrls = new Set(context.evidence.map((item) => item.url));
    const confidence: Story["confidence"] =
      parsed.confidence === "high" || parsed.confidence === "medium" ? parsed.confidence : "low";
    const seriousness: Story["seriousness"] =
      parsed.seriousness === "serious" || parsed.seriousness === "mixed"
        ? parsed.seriousness
        : "harmless";

    return {
      selected: Boolean(parsed.selected),
      summary: stringValue(parsed.summary, context.snippet || context.title),
      detailedSummary: stringValue(parsed.detailedSummary, parsed.summary || context.snippet || context.title),
      whyItsWeird: stringValue(parsed.whyItsWeird, "The event was flagged as unusually improbable or unexpected."),
      category: stringValue(parsed.category, "Uncategorized"),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((item: unknown) => typeof item === "string").slice(0, 8)
        : [],
      country: stringValue(parsed.country, "Unknown"),
      region: stringValue(parsed.region, "Unknown"),
      eventDate: typeof parsed.eventDate === "string" ? parsed.eventDate : null,
      absurdityScore: score(parsed.absurdityScore, context.localScore),
      noveltyScore: score(parsed.noveltyScore, context.localScore),
      humorScore: score(parsed.humorScore, 0),
      seriousnessScore: score(parsed.seriousnessScore, 20),
      credibilityScore: score(parsed.credibilityScore, 40),
      confidence,
      seriousness,
      verificationNotes: stringValue(
        parsed.verificationNotes,
        "Evidence was insufficient for a stronger verification note.",
      ),
      corroboratingUrls: Array.isArray(parsed.corroboratingUrls)
        ? parsed.corroboratingUrls.filter(
            (url: unknown) => typeof url === "string" && allowedUrls.has(url),
          )
        : [],
    };
  }
}
