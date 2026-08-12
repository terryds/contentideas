import schemaSql from "./schema.sql" with { type: "text" };
import { db } from "./db";

// Idempotent, numbered migrations tracked via PRAGMA user_version.
// Schema changes after M0 ship as additive steps appended to this list.
const migrations: string[] = [
  schemaSql, // 1 — full initial schema
  "ALTER TABLE runs ADD COLUMN error_text TEXT", // 2 — run-level errors (systematic filter failure, notify failures)
];

const defaultSettings: Record<string, string> = {
  check_interval: "30m",
  voice_examples_count: "5",
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

export function migrate(): void {
  const current = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = current; i < migrations.length; i++) {
    db.transaction(() => {
      db.exec(migrations[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
    })();
    console.log(`[migrate] applied migration ${i + 1}`);
  }
  const seed = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(defaultSettings)) seed.run(key, value);
}

export function pruneOldRuns(): void {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const pruned = db
    .prepare("DELETE FROM run_sources WHERE run_id IN (SELECT id FROM runs WHERE started_at < ?)")
    .run(cutoff);
  db.prepare("DELETE FROM runs WHERE started_at < ?").run(cutoff);
  if (pruned.changes > 0) console.log(`[migrate] pruned runs older than 30 days`);
}
