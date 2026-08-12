-- Content Engine schema. Owned by plans/core.md; applied by migrate.ts (step 1).

CREATE TABLE IF NOT EXISTS sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  type          TEXT NOT NULL CHECK (type IN ('youtube','twitter','hn','rss')),
  handle_or_url TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  channel_id    TEXT,               -- YouTube only: resolved once at add time
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     INTEGER NOT NULL,
  source_type   TEXT NOT NULL,      -- denormalized at ingestion: survives source removal
  source_label  TEXT NOT NULL,      -- e.g. "rss:swyx.io", "hn:frontpage"
  external_id   TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT,
  content       TEXT,
  transcript    TEXT,
  filter_status TEXT NOT NULL DEFAULT 'pending' CHECK (filter_status IN ('pending','matched','skipped')),
  filter_reason TEXT,
  filtered_at   TEXT,
  state         TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new','notified','drafted','posted','dismissed')),
  created_at    TEXT NOT NULL,
  UNIQUE (source_id, external_id)
);

CREATE TABLE IF NOT EXISTS threads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id   INTEGER NOT NULL,
  draft_json TEXT NOT NULL,         -- JSON array of tweet strings
  final_text TEXT,
  posted_at  TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger     TEXT NOT NULL CHECK (trigger IN ('cron','manual')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  new_count     INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  failed_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS run_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id        INTEGER NOT NULL,
  source_id     INTEGER NOT NULL,
  source_label  TEXT NOT NULL,
  new_count     INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('ok','retrying','failed')),
  error_text    TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
