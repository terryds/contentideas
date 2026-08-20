// Full runOnce() pipeline against a localhost fixture feed with a stubbed
// claude binary — deterministic, zero external network, no credentials.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../server/db/db";
import { runOnce } from "../../server/scheduler";
import { createApp } from "../../server/app";
import { claudeStubPath, resetDb, rssDoc, serveFixture, type FixtureServer } from "../helpers";

const app = createApp();
let feed: FixtureServer;

const ITEMS = [
  { guid: "p1", title: "First post", link: "https://fixture.example/p1" },
  { guid: "p2", title: "Second post", link: "https://fixture.example/p2" },
];
const NEW_ITEM = { guid: "p3", title: "Fresh post with numbers", link: "https://fixture.example/p3?utm_source=feed" };

beforeAll(() => {
  process.env.CONTENT_ENGINE_CLAUDE_BIN = claudeStubPath();
  feed = serveFixture(rssDoc(ITEMS));
});
afterAll(() => feed.stop());
beforeEach(() => {
  resetDb();
  feed.setBody(rssDoc(ITEMS));
});

async function addFixtureSource(): Promise<number> {
  const res = await app.request("/api/sources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "rss", input: feed.url }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

describe("ingestion pipeline", () => {
  test("first fetch is judged → new item → filter, notify attempt, clustering, dedupe", async () => {
    const sourceId = await addFixtureSource();

    // Run 1: a source's first fetch is judged like any other (no initial-import
    // rule — owner's call: full judgment over a silent baseline).
    const run1 = (await runOnce("manual")) as number;
    expect(run1).not.toBeNull();
    const imported = db.prepare("SELECT filter_status, filter_reason FROM entries").all() as {
      filter_status: string; filter_reason: string;
    }[];
    expect(imported).toHaveLength(2);
    for (const entry of imported) {
      expect(entry.filter_status).toBe("matched"); // the stub matches everything
      expect(entry.filter_reason).toBe("stub filter says this fits");
    }

    // The feed gains a post.
    feed.setBody(rssDoc([...ITEMS, NEW_ITEM]));
    const run2 = (await runOnce("manual")) as number;

    // Exactly the new entry was ingested and judged by the stub.
    const fresh = db.prepare("SELECT * FROM entries WHERE external_id = 'p3'").get() as Record<string, unknown>;
    expect(fresh.filter_status).toBe("matched");
    expect(fresh.filter_reason).toBe("stub filter says this fits");
    expect(JSON.parse(fresh.topics as string)).toEqual(["stub-story", "stub-entity"]);
    expect(fresh.url_key).toBe("fixture.example/p3"); // tracking param stripped at ingestion

    // Run accounting: 1 new, 1 matched, source row ok on attempt 1.
    const runRow = db.prepare("SELECT * FROM runs WHERE id = ?").get(run2) as Record<string, unknown>;
    expect(runRow.new_count).toBe(1);
    expect(runRow.matched_count).toBe(1);
    expect(runRow.finished_at).toBeTruthy();
    const sourceRow = db
      .prepare("SELECT * FROM run_sources WHERE run_id = ? AND source_id = ?")
      .get(run2, sourceId) as Record<string, unknown>;
    expect(sourceRow.status).toBe("ok");
    expect(sourceRow.attempts).toBe(1);
    expect(sourceRow.matched_count).toBe(1);

    // Per-run entry detail: the run answers "why did/didn't each entry get picked up".
    const detail1 = (await app.request(`/api/runs/${run1}`).then((r) => r.json())) as {
      entries: { filter_status: string; filter_reason: string | null }[];
    };
    expect(detail1.entries).toHaveLength(2); // first fetch: both judged in run 1
    const detail2 = (await app.request(`/api/runs/${run2}`).then((r) => r.json())) as {
      entries: { title: string; filter_status: string; filter_reason: string | null; state: string }[];
    };
    expect(detail2.entries).toHaveLength(1); // only the fresh item was judged by run 2
    expect(detail2.entries[0].filter_status).toBe("matched");
    expect(detail2.entries[0].filter_reason).toBe("stub filter says this fits");

    // Telegram is unconfigured: the send was attempted, recorded, and the entry stays 'new' for a resend.
    expect(String(runRow.error_text)).toContain("Telegram send failed");
    expect(fresh.state).toBe("new");

    // The matched entry seeded a cluster, but one source never surfaces as trending.
    expect((db.prepare("SELECT COUNT(*) AS n FROM clusters").get() as { n: number }).n).toBe(1);
    const inbox = (await app.request("/api/entries?filter=all").then((r) => r.json())) as {
      entries: unknown[]; clusters: unknown[];
    };
    expect(inbox.entries).toHaveLength(3); // all judged now, all matched by the stub
    expect(inbox.clusters).toHaveLength(0); // one source only — never surfaces as trending

    // Run 3: unchanged feed → dedupe means zero new, no refiltering of decided entries.
    const run3 = (await runOnce("manual")) as number;
    const run3Row = db.prepare("SELECT new_count FROM runs WHERE id = ?").get(run3) as { new_count: number };
    expect(run3Row.new_count).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n).toBe(3);
  }, 30_000);

  test("clear-history wipes ingestion state, keeps voice pool, re-judges on next run", async () => {
    await addFixtureSource();
    await runOnce("manual"); // ingests + judges 2 entries
    // Seed one posted thread (voice pool) and one unposted draft.
    const now = new Date().toISOString();
    db.prepare("INSERT INTO threads (entry_id, draft_json, final_text, posted_at, updated_at) VALUES (1, '[\"final\"]', 'final', ?, ?)").run(now, now);
    db.prepare("INSERT INTO threads (entry_id, draft_json, updated_at) VALUES (2, '[\"draft\"]', ?)").run(now);

    const res = await app.request("/api/settings/clear-history", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cleared: { entries: number; drafts: number }; keptVoice: number };
    expect(body.cleared.entries).toBe(2);
    expect(body.cleared.drafts).toBe(1);
    expect(body.keptVoice).toBe(1);

    expect((db.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM runs").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM sources").get() as { n: number }).n).toBe(1); // sources survive
    expect((db.prepare("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n).toBe(1); // posted kept

    // Next run re-ingests the feed's current items and JUDGES every one (no
    // initial-import rule) — cleared data really does start over.
    await runOnce("manual");
    const reimported = db.prepare("SELECT filter_status, filter_reason FROM entries").all() as {
      filter_status: string; filter_reason: string;
    }[];
    expect(reimported).toHaveLength(2);
    for (const entry of reimported) {
      expect(entry.filter_status).toBe("matched"); // stub matches everything
      expect(entry.filter_reason).toBe("stub filter says this fits");
    }
  }, 30_000);

  test("a failing source retries with a trace and never blocks the healthy one", async () => {
    await addFixtureSource();
    // A source that died AFTER being added (add-time validation would refuse a
    // dead feed, so simulate the breakage by inserting directly).
    const dead = serveFixture("irrelevant");
    const deadUrl = dead.url;
    dead.stop();
    db.prepare(
      "INSERT INTO sources (type, handle_or_url, display_name, active, created_at) VALUES ('rss', ?, 'dead feed', 1, ?)",
    ).run(deadUrl, new Date().toISOString());

    const runId = (await runOnce("manual")) as number;
    const rows = db
      .prepare("SELECT * FROM run_sources WHERE run_id = ? ORDER BY id")
      .all(runId) as { status: string; attempts: number; error_text: string | null; new_count: number }[];
    expect(rows).toHaveLength(2);
    const healthy = rows.find((r) => r.status === "ok")!;
    const failing = rows.find((r) => r.status === "failed")!;
    expect(healthy.new_count).toBe(2); // fixture feed imported fine
    expect(failing.attempts).toBe(3);
    expect(failing.error_text).toContain("attempt 1");
    expect(failing.error_text).toContain("attempt 3");
    expect(failing.error_text).toContain("giving up after 3 attempts");
  }, 30_000);
});
