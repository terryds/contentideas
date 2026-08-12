import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const dataDir = join(import.meta.dir, "..", "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "content-engine.db"));
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

export function nowIso(): string {
  return new Date().toISOString();
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string | null }
    | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}
