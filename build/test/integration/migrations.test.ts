import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { db, nowIso } from "../../server/db/db";
import { migrate, migrateDb } from "../../server/db/migrate";
import { resetDb } from "../helpers";

describe("migrations", () => {
  beforeEach(resetDb);

  test("running migrate twice is a no-op", () => {
    const version = () => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    const before = version();
    migrate();
    migrate();
    expect(version()).toBe(before);
  });

  test("default settings are seeded but never overwrite saved values", () => {
    db.prepare("UPDATE settings SET value = '15m' WHERE key = 'check_interval'").run();
    migrate();
    const value = (db.prepare("SELECT value FROM settings WHERE key = 'check_interval'").get() as { value: string }).value;
    expect(value).toBe("15m");
  });
});

describe("v1 → M7 upgrade path", () => {
  test("a v1 database (user_version 2, existing posted thread) upgrades intact", async () => {
    // Build the v1 state by hand in an isolated database file.
    const path = join(process.env.CONTENT_ENGINE_DATA_DIR!, `upgrade-${Date.now()}.db`);
    const v1 = new Database(path);
    const schemaSql = await Bun.file(join(import.meta.dir, "..", "..", "server", "db", "schema.sql")).text();
    v1.exec(schemaSql);
    v1.exec("ALTER TABLE runs ADD COLUMN error_text TEXT");
    v1.exec("PRAGMA user_version = 2");
    const now = nowIso();
    v1.prepare(
      "INSERT INTO entries (source_id, source_type, source_label, external_id, title, url, filter_status, state, created_at) VALUES (1, 'rss', 'rss:x', 'e1', 'T', 'https://www.a.com/x?utm_source=z', 'matched', 'posted', ?)",
    ).run(now);
    v1.prepare(
      "INSERT INTO threads (entry_id, draft_json, final_text, posted_at, updated_at) VALUES (1, '[\"tweet one\"]', 'tweet one', ?, ?)",
    ).run(now, now);

    migrateDb(v1);

    expect((v1.query("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(3);
    const thread = v1.prepare("SELECT * FROM threads WHERE id = 1").get() as Record<string, unknown>;
    expect(thread.entry_id).toBe(1);
    expect(thread.cluster_id).toBeNull();
    expect(thread.final_text).toBe("tweet one");
    // url_key backfilled for the recent entry, tracking param stripped
    expect((v1.prepare("SELECT url_key FROM entries WHERE id = 1").get() as { url_key: string }).url_key).toBe("a.com/x");
    // exactly one of entry_id / cluster_id is enforced
    expect(() =>
      v1.prepare("INSERT INTO threads (entry_id, cluster_id, draft_json, updated_at) VALUES (1, 1, '[]', ?)").run(now),
    ).toThrow();
    v1.close();
  });
});
