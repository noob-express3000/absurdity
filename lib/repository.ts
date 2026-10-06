import { randomUUID } from "node:crypto";
import { getDatabase, type SqlStatement } from "./database";
import { demoBriefing } from "./demo-data";
import type { Briefing, ResearchStep, Story, StorySource, IngestedEvidence } from "./types";

export interface StoryRepository {
  getCurrentBriefing(): Promise<Briefing>;
  getStory(id: string): Promise<Story | null>;
  searchStories(query: string, limit?: number, dates?: ArchiveDates): Promise<Story[]>;
}

export type ArchiveDates = { from?: string; before?: string };

export type ResearchRunRecord = {
  id?: string;
  startedAt: string;
  completedAt?: string;
  windowStart: string;
  windowEnd: string;
  status: "running" | "complete" | "failed";
  scanned: number;
  candidates: number;
  selected: number;
  failures: string[];
  providerUsage: Record<string, number | string | boolean>;
};

type StoryRow = {
  id: string;
  cluster_id: string;
  rank: number;
  title: string;
  short_title: string;
  summary: string;
  detailed_summary: string;
  why_weird: string;
  category: string;
  tags_json: string;
  country: string;
  region: string;
  event_date: string;
  publication_date: string;
  discovered_at: string;
  absurdity_score: number;
  novelty_score: number;
  humor_score: number;
  seriousness_score: number;
  credibility_score: number;
  confidence: Story["confidence"];
  seriousness: Story["seriousness"];
  verification_notes: string;
  status: Story["status"];
  is_fixture: number;
};

type SourceRow = {
  publisher: string;
  url: string;
  published_at: string;
  source_type: StorySource["sourceType"];
};

type StepRow = {
  label: string;
  detail: string;
  status: ResearchStep["status"];
  at_value: string;
};

function safeTags(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag) => typeof tag === "string") : [];
  } catch {
    return [];
  }
}

function rowToStory(row: StoryRow, sources: StorySource[], research: ResearchStep[]): Story {
  return {
    id: row.id,
    rank: Number(row.rank),
    title: row.title,
    shortTitle: row.short_title,
    summary: row.summary,
    detailedSummary: row.detailed_summary,
    whyItsWeird: row.why_weird,
    category: row.category,
    tags: safeTags(row.tags_json),
    country: row.country,
    region: row.region,
    eventDate: row.event_date,
    publicationDate: row.publication_date,
    discoveredAt: row.discovered_at,
    absurdityScore: Number(row.absurdity_score),
    noveltyScore: Number(row.novelty_score),
    humorScore: Number(row.humor_score),
    seriousnessScore: Number(row.seriousness_score),
    credibilityScore: Number(row.credibility_score),
    confidence: row.confidence,
    seriousness: row.seriousness,
    clusterId: row.cluster_id,
    sources,
    verificationNotes: row.verification_notes,
    status: row.status,
    research,
    isFixture: Boolean(Number(row.is_fixture)),
  };
}

export class DemoStoryRepository implements StoryRepository {
  async getCurrentBriefing() {
    return demoBriefing;
  }

  async getStory(id: string) {
    return demoBriefing.stories.find((story) => story.id === id) ?? null;
  }

  async searchStories(query: string, limit = 200, dates: ArchiveDates = {}) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = demoBriefing.stories.filter((story) => {
      const haystack =
          [
            story.title,
            story.summary,
            story.category,
            story.country,
            story.region,
            story.tags.join(" "),
          ]
            .join(" ")
            .toLowerCase();
      return terms.every((term) => haystack.includes(term)) &&
        (!dates.from || Date.parse(story.publicationDate) >= Date.parse(dates.from)) &&
        (!dates.before || Date.parse(story.publicationDate) < Date.parse(dates.before));
    });

    return matches.slice(0, limit);
  }
}

export class PersistentStoryRepository implements StoryRepository {
  private async hydrate(row: StoryRow) {
    const database = await getDatabase();

    const [sourceRows, stepRows] = await Promise.all([
      database.query<SourceRow>(
        "SELECT publisher, url, published_at, source_type FROM story_sources WHERE story_id = ? ORDER BY published_at ASC",
        [row.id],
      ),
      database.query<StepRow>(
        "SELECT label, detail, status, at_value FROM research_steps WHERE story_id = ? ORDER BY ordinal ASC",
        [row.id],
      ),
    ]);

    const sources: StorySource[] = sourceRows.map((source) => ({
      publisher: source.publisher,
      url: source.url,
      publishedAt: source.published_at,
      sourceType: source.source_type,
    }));

    const research: ResearchStep[] = stepRows.map((step) => ({
      label: step.label,
      detail: step.detail,
      status: step.status,
      at: step.at_value,
    }));

    return rowToStory(row, sources, research);
  }

  async getCurrentBriefing(): Promise<Briefing> {
    const database = await getDatabase();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const rows = await database.query<StoryRow>(
      "SELECT * FROM stories WHERE status = ? AND publication_date >= ? AND publication_date <= ? ORDER BY rank ASC, absurdity_score DESC, publication_date DESC LIMIT ?",
      ["selected", cutoff, now, 100],
    );

    const stories = await Promise.all(rows.map((row) => this.hydrate(row)));
    const latestRun = await getLatestResearchRun();

    return {
      id: "live-" + new Date().toISOString().slice(0, 10),
      label: "Live Absurdity briefing",
      mode: "live",
      generatedAt: latestRun?.completed_at || new Date().toISOString(),
      window: "Most recent 48 hours",
      stats: {
        scanned: Number(latestRun?.scanned || 0),
        unusual: Number(latestRun?.candidates || 0),
        verified: stories.filter((story) => story.confidence !== "low").length,
        selected: stories.length,
        countries: new Set(stories.map((story) => story.country)).size,
      },
      stories,
    };
  }

  async getStory(id: string) {
    const database = await getDatabase();
    const rows = await database.query<StoryRow>("SELECT * FROM stories WHERE id = ? LIMIT 1", [id]);
    return rows[0] ? this.hydrate(rows[0]) : null;
  }

  async searchStories(query: string, limit = 200, dates: ArchiveDates = {}) {
    const database = await getDatabase();
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const clauses = ["status = 'selected'"];
    const args: (string | number)[] = [];
    for (const term of query.trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      clauses.push("LOWER(title || ' ' || summary || ' ' || category || ' ' || country || ' ' || region || ' ' || tags_json) LIKE ? ESCAPE '\\'");
      args.push("%" + term.replace(/[\\%_]/g, "\\$&") + "%");
    }
    if (dates.from) { clauses.push("julianday(publication_date) >= julianday(?)"); args.push(dates.from); }
    if (dates.before) { clauses.push("julianday(publication_date) < julianday(?)"); args.push(dates.before); }
    const rows = await database.query<StoryRow>(
      `SELECT * FROM stories WHERE ${clauses.join(" AND ")} ORDER BY julianday(publication_date) DESC, rank ASC LIMIT ?`,
      [...args, safeLimit],
    );

    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  async upsertStory(story: Story) {
    const database = await getDatabase();
    const now = new Date().toISOString();

    // A weaker recheck must not erase a story from the permanent selected archive.
    if (story.status !== "selected") {
      const existing = await database.query<{ status: string }>(
        "SELECT status FROM stories WHERE id = ?", [story.id],
      );
      if (existing[0]?.status === "selected") return;
    }

    const statements: SqlStatement[] = [
      {
        sql: `INSERT INTO stories (
          id, cluster_id, rank, title, short_title, summary, detailed_summary, why_weird,
          category, tags_json, country, region, event_date, publication_date, discovered_at,
          absurdity_score, novelty_score, humor_score, seriousness_score, credibility_score,
          confidence, seriousness, verification_notes, status, is_fixture, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          cluster_id = excluded.cluster_id,
          rank = excluded.rank,
          title = excluded.title,
          short_title = excluded.short_title,
          summary = excluded.summary,
          detailed_summary = excluded.detailed_summary,
          why_weird = excluded.why_weird,
          category = excluded.category,
          tags_json = excluded.tags_json,
          country = excluded.country,
          region = excluded.region,
          event_date = excluded.event_date,
          publication_date = excluded.publication_date,
          discovered_at = excluded.discovered_at,
          absurdity_score = excluded.absurdity_score,
          novelty_score = excluded.novelty_score,
          humor_score = excluded.humor_score,
          seriousness_score = excluded.seriousness_score,
          credibility_score = excluded.credibility_score,
          confidence = excluded.confidence,
          seriousness = excluded.seriousness,
          verification_notes = excluded.verification_notes,
          status = excluded.status,
          is_fixture = excluded.is_fixture,
          updated_at = excluded.updated_at`,
        params: [
          story.id,
          story.clusterId,
          story.rank,
          story.title,
          story.shortTitle,
          story.summary,
          story.detailedSummary,
          story.whyItsWeird,
          story.category,
          JSON.stringify(story.tags),
          story.country,
          story.region,
          story.eventDate,
          story.publicationDate,
          story.discoveredAt,
          story.absurdityScore,
          story.noveltyScore,
          story.humorScore,
          story.seriousnessScore,
          story.credibilityScore,
          story.confidence,
          story.seriousness,
          story.verificationNotes,
          story.status,
          story.isFixture ? 1 : 0,
          now,
          now,
        ],
      },
      { sql: "DELETE FROM story_sources WHERE story_id = ?", params: [story.id] },
      ...story.sources.map((source) => ({
        sql: "INSERT INTO story_sources (story_id, publisher, url, published_at, source_type) VALUES (?, ?, ?, ?, ?)",
        params: [story.id, source.publisher, source.url, source.publishedAt, source.sourceType],
      })),
      { sql: "DELETE FROM research_steps WHERE story_id = ?", params: [story.id] },
      ...story.research.map((step, index) => ({
        sql: "INSERT INTO research_steps (story_id, ordinal, label, detail, status, at_value) VALUES (?, ?, ?, ?, ?, ?)",
        params: [story.id, index, step.label, step.detail, step.status, step.at],
      })),
    ];

    await database.batch(statements, true);
  }
}

export async function saveStories(stories: Story[]) {
  const repository = new PersistentStoryRepository();
  for (const story of stories) {
    await repository.upsertStory(story);
  }
}

// Match the discovery shortlist against persisted selections before spending
// extraction, search, or model calls on an event the reader already has.
export async function findSelectedStoryMatches(clusterIds: string[], urls: string[], windowStart: string) {
  if (!clusterIds.length || !urls.length) return [];
  const database = await getDatabase();
  return database.query<{ cluster_id: string; url: string | null }>(
    `SELECT s.cluster_id, source.url FROM stories s
      LEFT JOIN story_sources source ON source.story_id = s.id
      WHERE s.status = 'selected' AND s.is_fixture = 0 AND
        ((s.cluster_id IN (${clusterIds.map(() => '?').join(',')}) AND s.publication_date >= ?) OR
         source.url IN (${urls.map(() => '?').join(',')}))`,
    [...clusterIds, windowStart, ...urls],
  );
}

export async function recordResearchRun(run: ResearchRunRecord) {
  const database = await getDatabase();
  const id = run.id || randomUUID();
  const createdAt = new Date().toISOString();

  await database.execute(
    `INSERT INTO research_runs (
      id, started_at, completed_at, window_start, window_end, status,
      scanned, candidates, selected, failures_json, provider_usage_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      completed_at = excluded.completed_at,
      status = excluded.status,
      scanned = excluded.scanned,
      candidates = excluded.candidates,
      selected = excluded.selected,
      failures_json = excluded.failures_json,
      provider_usage_json = excluded.provider_usage_json`,
    [
      id,
      run.startedAt,
      run.completedAt || null,
      run.windowStart,
      run.windowEnd,
      run.status,
      run.scanned,
      run.candidates,
      run.selected,
      JSON.stringify(run.failures),
      JSON.stringify(run.providerUsage),
      createdAt,
    ],
  );

  return id;
}

export async function getLatestResearchRun() {
  const database = await getDatabase();
  const rows = await database.query<{
    id: string;
    started_at: string;
    completed_at: string | null;
    window_start: string;
    window_end: string;
    status: string;
    scanned: number;
    candidates: number;
    selected: number;
    failures_json: string;
    provider_usage_json: string;
  }>("SELECT * FROM research_runs ORDER BY started_at DESC LIMIT 1");

  return rows[0] || null;
}

const demoStoryRepository = new DemoStoryRepository();
const persistentStoryRepository = new PersistentStoryRepository();

function activeStoryRepository(): StoryRepository {
  return process.env.ABSURDITY_MODE === "demo"
    ? demoStoryRepository
    : persistentStoryRepository;
}

export const storyRepository: StoryRepository = {
  getCurrentBriefing: () => activeStoryRepository().getCurrentBriefing(),
  getStory: (id) => activeStoryRepository().getStory(id),
  searchStories: (query, limit, dates) => activeStoryRepository().searchStories(query, limit, dates),
};

// Full source bodies stay out of the public reader payloads.
export async function saveStoryEvidence(storyId: string, evidence: IngestedEvidence[]) {
  if (!evidence.length) return;

  const database = await getDatabase();
  const statements: SqlStatement[] = evidence.map((item) => ({
    sql: `INSERT INTO story_evidence (
      story_id, url, publisher, title, resolved_url, published_at, fetched_at, status,
      method, body_text, original_length, truncated, content_hash, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(story_id, url) DO UPDATE SET
      publisher = excluded.publisher, title = excluded.title, resolved_url = excluded.resolved_url,
      published_at = excluded.published_at, fetched_at = excluded.fetched_at, status = excluded.status,
      method = excluded.method, body_text = excluded.body_text, original_length = excluded.original_length,
      truncated = excluded.truncated, content_hash = excluded.content_hash, error = excluded.error
    WHERE story_evidence.status != 'article' OR (excluded.status = 'article' AND (story_evidence.truncated = 1 OR excluded.truncated = 0))`,
    params: [storyId, item.url, item.publisher, item.title, item.resolvedUrl, item.publishedAt ?? null,
      item.fetchedAt, item.status, item.method, item.text, item.originalLength, item.truncated ? 1 : 0,
      item.contentHash, item.error ?? null],
  }));

  await database.batch(statements, true);
}

export async function getStoryEvidence(storyId: string): Promise<IngestedEvidence[]> {
  const database = await getDatabase();
  const rows = await database.query<{
    url:string; publisher:string; title:string; resolved_url:string; published_at:string|null;
    fetched_at:string; status:IngestedEvidence['status']; method:IngestedEvidence['method']; body_text:string;
    original_length:number; truncated:number; content_hash:string; error:string|null;
  }>('SELECT * FROM story_evidence WHERE story_id = ? ORDER BY url', [storyId]);
  return rows.map(row => ({url:row.url, publisher:row.publisher, title:row.title, resolvedUrl:row.resolved_url,
    ...(row.published_at ? {publishedAt:row.published_at} : {}), fetchedAt:row.fetched_at, status:row.status,
    method:row.method, text:row.body_text, originalLength:Number(row.original_length), truncated:Boolean(row.truncated),
    contentHash:row.content_hash, ...(row.error ? {error:row.error} : {})}));
}
