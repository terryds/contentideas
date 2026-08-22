// Full runOnce() pipeline against a localhost fixture feed with a stubbed
// claude binary — deterministic, zero external network, no credentials.

import { describe, expect, test, beforeAll, afterAll, beforeEach } from "bun:test";
import { db } from "../../server/db/db";
import { runOnce, runTrendingJob } from "../../server/scheduler";
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

    // The feed gains a post; the owner has a tag vocabulary configured.
    db.prepare("UPDATE settings SET value = 'stub-tag, unused-tag' WHERE key = 'tags'").run();
    feed.setBody(rssDoc([...ITEMS, NEW_ITEM]));
    const run2 = (await runOnce("manual")) as number;

    // Exactly the new entry was ingested and judged by the stub.
    const fresh = db.prepare("SELECT * FROM entries WHERE external_id = 'p3'").get() as Record<string, unknown>;
    expect(fresh.filter_status).toBe("matched");
    expect(fresh.filter_reason).toBe("stub filter says this fits");
    expect(JSON.parse(fresh.topics as string)).toEqual(["stub-story", "stub-entity"]);
    // vocabulary tag kept, the stub's invented tag discarded
    expect(JSON.parse(fresh.tags as string)).toEqual(["stub-tag"]);
    expect(fresh.score).toBe(7); // rubric score stored from the same judgment
    expect(fresh.url_key).toBe("fixture.example/p3"); // tracking param stripped at ingestion

    // Tag filter + tag counts flow through the inbox API.
    const tagged = (await app.request("/api/entries?filter=tag:stub-tag").then((r) => r.json())) as {
      entries: unknown[]; tagCounts: { tag: string; n: number }[];
    };
    expect(tagged.entries).toHaveLength(1);
    expect(tagged.tagCounts).toEqual([{ tag: "stub-tag", n: 1 }]);
    const untagged = (await app.request("/api/entries?filter=tag:unused-tag").then((r) => r.json())) as {
      entries: unknown[];
    };
    expect(untagged.entries).toHaveLength(0);

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

    // Clustering belongs to the daily trending job now — fetch runs never cluster.
    expect((db.prepare("SELECT COUNT(*) AS n FROM clusters").get() as { n: number }).n).toBe(0);
    const trendingRun = (await runTrendingJob("manual")) as number;
    expect(
      (db.prepare("SELECT trigger FROM runs WHERE id = ?").get(trendingRun) as { trigger: string }).trigger,
    ).toBe("trending");
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

  test("per-source cadence: max_records caps the fetch; cron ticks only fetch due sources", async () => {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rss", input: feed.url, check_interval: "15m", max_records: 1 }),
    });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: number };

    // Manual run: fetches regardless of due-ness, but max_records=1 caps ingestion.
    await runOnce("manual");
    expect((db.prepare("SELECT COUNT(*) AS n FROM entries").get() as { n: number }).n).toBe(1);

    // Just fetched → the next cron tick has nothing due → no run row at all.
    expect(await runOnce("cron")).toBeNull();

    // Past the interval → due again.
    db.prepare("UPDATE sources SET last_fetched_at = ?").run(new Date(Date.now() - 16 * 60_000).toISOString());
    expect(await runOnce("cron")).not.toBeNull();

    // Inline cadence edit: valid update ok, junk rejected.
    expect(
      (
        await app.request(`/api/sources/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ max_records: 2, check_interval: "1h" }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(`/api/sources/${id}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ check_interval: "7m" }),
        })
      ).status,
    ).toBe(400);
  }, 30_000);

  test("auto-drafts from selected tags: threads created, digest attempted, Drafts API lists them", async () => {
    await addFixtureSource();
    db.prepare("UPDATE settings SET value = 'stub-tag, other' WHERE key = 'tags'").run();
    db.prepare("UPDATE settings SET value = 'stub-tag' WHERE key = 'auto_draft_tags'").run();

    const runId = (await runOnce("manual")) as number; // both entries match w/ stub-tag → auto-drafted
    const threads = db.prepare("SELECT * FROM threads ORDER BY id").all() as { entry_id: number | null; draft_json: string }[];
    expect(threads).toHaveLength(2);
    expect(JSON.parse(threads[0].draft_json)[0]).toContain("Stub tweet one");
    const states = db.prepare("SELECT state FROM entries").all() as { state: string }[];
    expect(states.every((s) => s.state === "drafted")).toBe(true);

    // Digest attempted (telegram unconfigured → recorded, not retried).
    const runRow = db.prepare("SELECT error_text FROM runs WHERE id = ?").get(runId) as { error_text: string };
    expect(runRow.error_text).toContain("Draft digest send failed");

    // Drafts API: list + counts + filters.
    const list = (await app.request("/api/threads").then((r) => r.json())) as {
      threads: { subject_title: string; entry_id: number | null }[];
      counts: { total: number; unposted: number; posted: number };
    };
    expect(list.counts).toEqual({ total: 2, unposted: 2, posted: 0 });
    expect(list.threads[0].subject_title).toBeTruthy();
    const posted = (await app.request("/api/threads?filter=posted").then((r) => r.json())) as { threads: unknown[] };
    expect(posted.threads).toHaveLength(0);

    // Next run: nothing new to draft, no digest attempt.
    const run2 = (await runOnce("manual")) as number;
    expect((db.prepare("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n).toBe(2);
    const run2Row = db.prepare("SELECT error_text FROM runs WHERE id = ?").get(run2) as { error_text: string | null };
    expect(run2Row.error_text ?? "").not.toContain("Draft digest");
  }, 30_000);

  test("max_auto_drafts caps the ranked picks; unpicked candidates stay in the Inbox", async () => {
    await addFixtureSource();
    feed.setBody(rssDoc([...ITEMS, NEW_ITEM])); // 3 items in the feed
    db.prepare("UPDATE settings SET value = 'stub-tag' WHERE key = 'tags'").run();
    db.prepare("UPDATE settings SET value = 'stub-tag' WHERE key = 'auto_draft_tags'").run();
    db.prepare("UPDATE settings SET value = '1' WHERE key = 'max_auto_drafts'").run();

    await runOnce("manual"); // 3 candidates → ranker consulted → cap allows only 1 draft
    expect((db.prepare("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n).toBe(1);
    const states = db.prepare("SELECT state, COUNT(*) AS n FROM entries GROUP BY state ORDER BY state").all() as {
      state: string; n: number;
    }[];
    expect(states).toEqual([
      { state: "drafted", n: 1 },
      { state: "new", n: 2 }, // unpicked: still ordinary matched entries
    ]);
  }, 30_000);

  test("clock-mode source is due exactly when a scheduled time has passed since its last fetch", async () => {
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rss", input: feed.url, schedule_times: "07:00, 19:00" }),
    });
    expect(res.status).toBe(201);

    // Never fetched → due immediately.
    expect(await runOnce("cron")).not.toBeNull();

    // Just fetched → not due until the next scheduled time.
    expect(await runOnce("cron")).toBeNull();

    // Pretend the last fetch happened 25h ago — a scheduled slot has certainly
    // passed since then, so the source is due (missed slots fire once).
    db.prepare("UPDATE sources SET last_fetched_at = ?").run(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString());
    expect(await runOnce("cron")).not.toBeNull();

    // Bad times are rejected.
    const bad = await app.request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rss", input: feed.url + "?x=1", schedule_times: "25:00" }),
    });
    expect(bad.status).toBe(400);
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

  test("per-source Run now fetches exactly that source through the full pipeline", async () => {
    const idA = await addFixtureSource();
    const second = serveFixture(rssDoc([{ guid: "b1", title: "Other feed post", link: "https://other.example/b1" }]));
    const res = await app.request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rss", input: second.url }),
    });
    expect(res.status).toBe(201);

    const trigger = await app.request(`/api/sources/${idA}/run`, { method: "POST" });
    expect(trigger.status).toBe(200);
    const { runId, alreadyRunning } = (await trigger.json()) as { runId: number; alreadyRunning: boolean };
    expect(alreadyRunning).toBe(false);
    // The run row exists immediately; wait for it to finish.
    for (let i = 0; i < 100; i++) {
      const row = db.prepare("SELECT finished_at FROM runs WHERE id = ?").get(runId) as { finished_at: string | null };
      if (row.finished_at) break;
      await Bun.sleep(100);
    }
    const perSource = db.prepare("SELECT source_id FROM run_sources WHERE run_id = ?").all(runId) as { source_id: number }[];
    expect(perSource).toEqual([{ source_id: idA }]); // only the requested source
    expect((db.prepare("SELECT COUNT(*) AS n FROM entries WHERE source_id = ?").get(idA) as { n: number }).n).toBe(2);

    // Paused and unknown sources are refused.
    await app.request(`/api/sources/${idA}/pause`, { method: "POST" });
    expect((await app.request(`/api/sources/${idA}/run`, { method: "POST" })).status).toBe(400);
    expect((await app.request("/api/sources/999/run", { method: "POST" })).status).toBe(404);
    second.stop();
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
