CREATE TABLE IF NOT EXISTS stories (
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
);

CREATE TABLE IF NOT EXISTS story_sources (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  publisher TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT NOT NULL,
  source_type TEXT NOT NULL,
  PRIMARY KEY (story_id, url)
);

CREATE TABLE IF NOT EXISTS research_steps (
  story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  label TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL,
  at_value TEXT NOT NULL,
  PRIMARY KEY (story_id, ordinal)
);

CREATE TABLE IF NOT EXISTS research_runs (
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
);

CREATE TABLE IF NOT EXISTS research_heartbeat (
  run_id TEXT PRIMARY KEY REFERENCES research_runs(id) ON DELETE CASCADE,
  updated_at INTEGER NOT NULL,
  phase TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stories_publication_date ON stories(publication_date);
CREATE INDEX IF NOT EXISTS idx_stories_status_date ON stories(status, publication_date);
CREATE INDEX IF NOT EXISTS idx_stories_country ON stories(country);
CREATE INDEX IF NOT EXISTS idx_stories_region ON stories(region);
CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category);
CREATE INDEX IF NOT EXISTS idx_stories_cluster ON stories(cluster_id);
CREATE INDEX IF NOT EXISTS idx_sources_url ON story_sources(url);
CREATE INDEX IF NOT EXISTS idx_runs_started_at ON research_runs(started_at);
