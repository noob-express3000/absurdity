import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createClient } from "@tursodatabase/serverless/compat";

export type DatabaseKind = "turso" | "sqlite";

export interface SqlDatabase {
  kind: DatabaseKind;
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<number>;
}

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    cluster_id TEXT NOT NULL,
    rank INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    short_title TEXT NOT NULL,
    summary TEXT NOT NULL,
    detailed_summary TEXT NOT NULL,
    why_weird TEXT NOT NULL,
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL,
    country TEXT NOT NULL,
    region TEXT NOT NULL,
    event_date TEXT NOT NULL,
    publication_date TEXT NOT NULL,
    discovered_at TEXT NOT NULL,
    absurdity_score INTEGER NOT NULL,
    novelty_score INTEGER NOT NULL,
    humor_score INTEGER NOT NULL,
    seriousness_score INTEGER NOT NULL,
    credibility_score INTEGER NOT NULL,
    confidence TEXT NOT NULL,
    seriousness TEXT NOT NULL,
    verification_notes TEXT NOT NULL,
    status TEXT NOT NULL,
    is_fixture INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS story_sources (
    story_id TEXT NOT NULL,
    publisher TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    source_type TEXT NOT NULL,
    PRIMARY KEY (story_id, url),
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS story_evidence (
    story_id TEXT NOT NULL,
    url TEXT NOT NULL,
    publisher TEXT NOT NULL,
    title TEXT NOT NULL,
    resolved_url TEXT NOT NULL,
    published_at TEXT,
    fetched_at TEXT NOT NULL,
    status TEXT NOT NULL,
    method TEXT NOT NULL,
    body_text TEXT NOT NULL,
    original_length INTEGER NOT NULL,
    truncated INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    error TEXT,
    PRIMARY KEY (story_id, url),
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS research_steps (
    story_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    label TEXT NOT NULL,
    detail TEXT NOT NULL,
    status TEXT NOT NULL,
    at_value TEXT NOT NULL,
    PRIMARY KEY (story_id, ordinal),
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS research_runs (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    window_start TEXT NOT NULL,
    window_end TEXT NOT NULL,
    status TEXT NOT NULL,
    scanned INTEGER NOT NULL DEFAULT 0,
    candidates INTEGER NOT NULL DEFAULT 0,
    selected INTEGER NOT NULL DEFAULT 0,
    failures_json TEXT NOT NULL,
    provider_usage_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_stories_publication_date ON stories(publication_date)",
  "CREATE INDEX IF NOT EXISTS idx_stories_status_date ON stories(status, publication_date)",
  "CREATE INDEX IF NOT EXISTS idx_stories_country ON stories(country)",
  "CREATE INDEX IF NOT EXISTS idx_stories_region ON stories(region)",
  "CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category)",
  "CREATE INDEX IF NOT EXISTS idx_stories_cluster ON stories(cluster_id)",
  "CREATE INDEX IF NOT EXISTS idx_sources_url ON story_sources(url)",
  "CREATE INDEX IF NOT EXISTS idx_runs_started_at ON research_runs(started_at)",
];

class TursoDatabase implements SqlDatabase {
  kind: DatabaseKind = "turso";
  private client: ReturnType<typeof createClient>;

  constructor(url: string, authToken: string) {
    this.client = createClient({ url, authToken });
  }

  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const result = await this.client.execute({
      sql,
      args: params as any[],
    });
    return result.rows as unknown as T[];
  }

  async execute(sql: string, params: unknown[] = []) {
    const result = await this.client.execute({
      sql,
      args: params as any[],
    });
    return Number(result.rowsAffected);
  }
}

class SqliteDatabase implements SqlDatabase {
  kind: DatabaseKind = "sqlite";
  private db: DatabaseSync;

  private constructor(db: DatabaseSync) {
    this.db = db;
  }

  static async open(path: string) {
    if (path !== ":memory:") {
      await mkdir(dirname(path), { recursive: true });
    }

    const db = new DatabaseSync(path);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    return new SqliteDatabase(db);
  }

  async query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []) {
    const statement = this.db.prepare(sql);
    return statement.all(...(params as any[])) as T[];
  }

  async execute(sql: string, params: unknown[] = []) {
    const statement = this.db.prepare(sql);
    const result = statement.run(...(params as any[]));
    return Number(result.changes);
  }
}

let databasePromise: Promise<SqlDatabase> | null = null;
let initialized = false;

async function initialize(database: SqlDatabase) {
  if (initialized) return database;

  await database.execute("PRAGMA foreign_keys = ON");
  for (const statement of schemaStatements) {
    await database.execute(statement);
  }

  initialized = true;
  return database;
}

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = (async () => {
      const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
      const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

      if (tursoUrl) {
        if (!tursoToken) {
          throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is configured.");
        }
        return initialize(new TursoDatabase(tursoUrl, tursoToken));
      }

      return initialize(
        await SqliteDatabase.open(
          process.env.ABSURDITY_SQLITE_PATH?.trim() || ".data/absurdity.db",
        ),
      );
    })();
  }

  return databasePromise;
}

export async function databaseStatus() {
  try {
    const database = await getDatabase();
    await database.query("SELECT 1 AS ok");
    return { ready: true, kind: database.kind };
  } catch (error) {
    return {
      ready: false,
      kind: process.env.TURSO_DATABASE_URL ? "turso" : "sqlite",
      error: error instanceof Error ? error.message : "Database unavailable",
    };
  }
}

