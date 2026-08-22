// The M7 clustering matrix — kept from the milestone verification scripts.

import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { db, nowIso, setSetting } from "../../server/db/db";
import { activeClusters, distinctSourceCount, normalizeUrlKey, trendingPass } from "../../server/trending/cluster";
import { autoDraftPass } from "../../server/drafts";
import { claudeStubPath, resetDb } from "../helpers";

let extId = 0;

function addSource(name: string): number {
  return db
    .prepare("INSERT INTO sources (type, handle_or_url, display_name, active, created_at) VALUES ('rss', ?, ?, 1, ?)")
    .run(name, name, nowIso()).lastInsertRowid as number;
}

function addEntry(
  sourceId: number,
  title: string,
  url: string | null,
  topics: string[] | null,
  reason = "matched",
): number {
  return db
    .prepare(
      `INSERT INTO entries (source_id, source_type, source_label, external_id, title, url, content, url_key, topics,
         filter_status, filter_reason, filtered_at, state, created_at)
       VALUES (?, 'rss', ?, ?, ?, ?, 'content', ?, ?, 'matched', ?, ?, 'new', ?)`,
    )
    .run(
      sourceId, `rss:s${sourceId}`, `ext-${++extId}`, title, url, normalizeUrlKey(url),
      topics ? JSON.stringify(topics) : null, reason, nowIso(), nowIso(),
    ).lastInsertRowid as number;
}

function newRun(): number {
  return db.prepare("INSERT INTO runs (trigger, started_at) VALUES ('manual', ?)").run(nowIso()).lastInsertRowid as number;
}

function runError(runId: number): string {
  return (
    (db.prepare("SELECT error_text FROM runs WHERE id = ?").get(runId) as { error_text: string | null }).error_text ?? ""
  );
}

describe("trending clustering", () => {
  let srcA: number, srcB: number;
  beforeEach(() => {
    resetDb();
    extId = 0;
    srcA = addSource("feed-a");
    srcB = addSource("feed-b");
  });

  test("URL tier: same normalized URL from two sources → one cluster, one send attempt, skipped member included", async () => {
    addEntry(srcA, "Big story", "https://www.example.com/big-story?utm_source=rss", ["big-story", "example"]);
    addEntry(srcB, "Big story (B's take)", "https://example.com/big-story/", ["unrelated-slug"], "off-taste");
    const run = newRun();
    await trendingPass(run);

    const clusters = db.prepare("SELECT * FROM clusters").all() as { id: number; notified_at: string | null }[];
    expect(clusters).toHaveLength(1);
    expect(distinctSourceCount(clusters[0].id)).toBe(2);
    // No Telegram creds: send attempted, recorded, NOT stamped → retried next run.
    expect(runError(run)).toContain("Trending Telegram send failed");
    expect(clusters[0].notified_at).toBeNull();

    const active = activeClusters();
    expect(active).toHaveLength(1);
    expect(active[0].members.some((m) => m.title.includes("B's take"))).toBe(true);
  });

  test("notified clusters are never re-notified", async () => {
    addEntry(srcA, "Story", "https://a.com/s", ["story-slug", "entity"]);
    addEntry(srcB, "Story again", "https://a.com/s", ["story-slug", "entity"]);
    await trendingPass(newRun());
    db.prepare("UPDATE clusters SET notified_at = ?").run(nowIso()); // simulate a delivered ping
    const run = newRun();
    await trendingPass(run);
    expect(runError(run)).toBe("");
  });

  test("topic tier: ≥2 overlapping slugs joins entries without a shared URL", async () => {
    addEntry(srcA, "GPT-6 drops", "https://siteone.com/gpt6", ["gpt-6-release", "openai"]);
    addEntry(srcB, "OpenAI ships GPT-6", "https://sitetwo.com/openai-gpt6", ["gpt-6-release", "openai", "benchmarks"]);
    await trendingPass(newRun());
    const clusters = db.prepare("SELECT id FROM clusters").all() as { id: number }[];
    expect(clusters).toHaveLength(1);
    expect(distinctSourceCount(clusters[0].id)).toBe(2);
  });

  test("one overlapping slug is not enough", async () => {
    addEntry(srcA, "About OpenAI", "https://one.com/a", ["openai", "hiring"]);
    addEntry(srcB, "Also OpenAI", "https://two.com/b", ["openai", "lawsuit"]);
    await trendingPass(newRun());
    expect((db.prepare("SELECT COUNT(*) AS n FROM clusters").get() as { n: number }).n).toBe(2);
  });

  test("threshold from settings gates both the ping and the Inbox payload", async () => {
    setSetting("trending_threshold", "3");
    addEntry(srcA, "Story", "https://a.com/s", ["story-slug", "entity"]);
    addEntry(srcB, "Story", "https://a.com/s", ["story-slug", "entity"]);
    const run = newRun();
    await trendingPass(run);
    expect(runError(run)).toBe(""); // 2 sources < 3 — no send attempted
    expect(activeClusters()).toHaveLength(0);
    setSetting("trending_threshold", "2");
    expect(activeClusters()).toHaveLength(1);
  });

  test("initial-import entries never cluster", async () => {
    addEntry(srcA, "Backlog", "https://a.com/old", ["old-story", "entity"], "initial import");
    await trendingPass(newRun());
    expect((db.prepare("SELECT COUNT(*) AS n FROM cluster_entries").get() as { n: number }).n).toBe(0);
  });

  test("same-source repeats cluster but never notify or surface", async () => {
    addEntry(srcA, "Solo", "https://solo.com/x", ["solo-story", "solo-entity"]);
    addEntry(srcA, "Solo again", "https://solo.com/x?utm_source=a", ["solo-story", "solo-entity"]);
    const run = newRun();
    await trendingPass(run);
    expect((db.prepare("SELECT COUNT(*) AS n FROM clusters").get() as { n: number }).n).toBe(1);
    expect(runError(run)).toBe("");
    expect(activeClusters()).toHaveLength(0);
  });

  test("trending auto-draft (default on): at-threshold cluster gets one thread + digest attempt, never re-drafted", async () => {
    process.env.CONTENT_ENGINE_CLAUDE_BIN = claudeStubPath();
    addEntry(srcA, "Story", "https://a.com/s", ["story-slug", "entity"]);
    addEntry(srcB, "Story again", "https://a.com/s", ["story-slug", "entity"]);
    await trendingPass(newRun());

    const runId = newRun();
    await autoDraftPass(runId);
    const threads = db.prepare("SELECT * FROM threads").all() as { cluster_id: number | null; entry_id: number | null }[];
    expect(threads).toHaveLength(1);
    expect(threads[0].cluster_id).not.toBeNull();
    expect(threads[0].entry_id).toBeNull();
    expect(runError(runId)).toContain("Draft digest send failed");

    // Second pass: the cluster has a thread → skipped, no digest.
    const run2 = newRun();
    await autoDraftPass(run2);
    expect((db.prepare("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n).toBe(1);
    expect(runError(run2)).toBe("");

    // Setting off: fresh cluster, no draft.
    setSetting("auto_draft_trending", "0");
    addEntry(srcA, "Other story", "https://b.com/x", ["other-story", "entity2"]);
    addEntry(srcB, "Other story too", "https://b.com/x", ["other-story", "entity2"]);
    await trendingPass(newRun());
    await autoDraftPass(newRun());
    expect((db.prepare("SELECT COUNT(*) AS n FROM threads").get() as { n: number }).n).toBe(1);
  });

  test("dismissed clusters stop surfacing and never notify", async () => {
    addEntry(srcA, "Story", "https://a.com/s", ["story-slug", "entity"]);
    addEntry(srcB, "Story", "https://a.com/s", ["story-slug", "entity"]);
    await trendingPass(newRun());
    db.prepare("UPDATE clusters SET dismissed_at = ?").run(nowIso());
    expect(activeClusters()).toHaveLength(0);
    const run = newRun();
    await trendingPass(run);
    expect(runError(run)).toBe("");
  });
});
