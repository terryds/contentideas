import schemaSql from "./schema.sql" with { type: "text" };
import { db } from "./db";
import { normalizeUrlKey, CLUSTER_WINDOW_MS } from "../trending/cluster";

// Idempotent, numbered migrations tracked via PRAGMA user_version.
// Schema changes after M0 ship as additive steps appended to this list.
const migrations: string[] = [
  schemaSql, // 1 — full initial schema
  "ALTER TABLE runs ADD COLUMN error_text TEXT", // 2 — run-level errors (systematic filter failure, notify failures)
  // 3 — M7 cross-source trending: story identity on entries, clusters, and
  // cluster-drafted threads (threads rebuilt so exactly one of entry_id /
  // cluster_id is set — SQLite can't relax NOT NULL in place).
  `
  ALTER TABLE entries ADD COLUMN topics TEXT;
  ALTER TABLE entries ADD COLUMN url_key TEXT;
  CREATE TABLE clusters (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT NOT NULL,
    slugs         TEXT NOT NULL DEFAULT '[]',
    url_keys      TEXT NOT NULL DEFAULT '[]',
    first_seen    TEXT NOT NULL,
    last_activity TEXT NOT NULL,
    notified_at   TEXT,
    dismissed_at  TEXT
  );
  CREATE TABLE cluster_entries (
    cluster_id INTEGER NOT NULL,
    entry_id   INTEGER NOT NULL,
    UNIQUE (cluster_id, entry_id)
  );
  CREATE TABLE threads_new (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    entry_id   INTEGER,
    cluster_id INTEGER,
    draft_json TEXT NOT NULL,
    final_text TEXT,
    posted_at  TEXT,
    updated_at TEXT NOT NULL,
    CHECK ((entry_id IS NULL) != (cluster_id IS NULL))
  );
  INSERT INTO threads_new (id, entry_id, draft_json, final_text, posted_at, updated_at)
    SELECT id, entry_id, draft_json, final_text, posted_at, updated_at FROM threads;
  DROP TABLE threads;
  ALTER TABLE threads_new RENAME TO threads;
  `,
  // 4 — per-run entry detail: attribute each entry to the run that ingested it
  // and the run whose filter pass produced its verdict.
  `
  ALTER TABLE entries ADD COLUMN created_run_id INTEGER;
  ALTER TABLE entries ADD COLUMN filtered_run_id INTEGER;
  `,
];

const defaultSettings: Record<string, string> = {
  check_interval: "30m",
  voice_examples_count: "5",
  trending_threshold: "2",
  taste_prompt:
    "You are my content scout. I write threads for indie hackers and AI-curious developers. " +
    "Match entries about: AI coding economics and real cost breakdowns, solo-founder pricing and monetization, " +
    "local-first software, contrarian takes with concrete numbers. " +
    "Skip: product launches with no lesson, drama, listicles, anything without a specific story or number.",
  generation_prompt:
    "Write a Twitter thread (3–6 tweets) about the item below. Hook first — a concrete number or " +
    "contrarian claim, no \"I'm going to tell you about…\". Each tweet stands alone. Plain language, " +
    "no hashtags, no emoji except sparingly in tweet 1. End with one practical takeaway, not a summary.",
};

/** Current schema version — what PRAGMA user_version reads after a full migrate. */
export const SCHEMA_VERSION = migrations.length;

/** Test seam: run the migration sequence against any Database handle. */
export function migrateDb(database: import("bun:sqlite").Database): void {
  const current = (database.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = current; i < migrations.length; i++) {
    database.transaction(() => {
      database.exec(migrations[i]);
      database.exec(`PRAGMA user_version = ${i + 1}`);
    })();
    console.log(`[migrate] applied migration ${i + 1}`);
  }
  const seed = database.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaultSettings)) seed.run(key, value);
  backfillUrlKeys(database);
}

export function migrate(): void {
  migrateDb(db);
}

// M7 backfill: entries filtered before trending shipped have no url_key.
// Compute it for the clustering window only (48h) — older entries can never
// join a cluster anyway. Topics stay empty for them (the URL tier still works).
function backfillUrlKeys(database: import("bun:sqlite").Database): void {
  const cutoff = new Date(Date.now() - CLUSTER_WINDOW_MS).toISOString();
  const rows = database
    .prepare("SELECT id, url FROM entries WHERE url_key IS NULL AND url IS NOT NULL AND created_at >= ?")
    .all(cutoff) as { id: number; url: string }[];
  const update = database.prepare("UPDATE entries SET url_key = ? WHERE id = ?");
  for (const row of rows) {
    const key = normalizeUrlKey(row.url);
    if (key) update.run(key, row.id);
  }
}

export function pruneOldRuns(): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const pruned = db
    .prepare("DELETE FROM run_sources WHERE run_id IN (SELECT id FROM runs WHERE started_at < ?)")
    .run(cutoff);
  db.prepare("DELETE FROM runs WHERE started_at < ?").run(cutoff);
  if (pruned.changes > 0) console.log(`[migrate] pruned runs older than 30 days`);
}
