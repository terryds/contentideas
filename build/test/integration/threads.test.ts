// Draft → edit → posted → voice-pool loop, for both entry and cluster drafts,
// with the stubbed claude binary.

import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { db, nowIso } from "../../server/db/db";
import { createApp } from "../../server/app";
import { composeGenerationPrompt } from "../../server/llm/generator";
import { claudeStubPath, resetDb } from "../helpers";

const app = createApp();
const json = { "content-type": "application/json" };

beforeAll(() => {
  process.env.CONTENT_ENGINE_CLAUDE_BIN = claudeStubPath();
});

function seedMatchedEntry(sourceId: number, title: string): number {
  return db
    .prepare(
      `INSERT INTO entries (source_id, source_type, source_label, external_id, title, url, content,
         filter_status, filter_reason, filtered_at, state, created_at)
       VALUES (?, 'rss', 'rss:fixture', ?, ?, 'https://f.example/x', 'some content', 'matched', 'fits', ?, 'new', ?)`,
    )
    .run(sourceId, `seed-${title}-${sourceId}`, title, nowIso(), nowIso()).lastInsertRowid as number;
}

function seedSource(name: string): number {
  return db
    .prepare("INSERT INTO sources (type, handle_or_url, display_name, active, created_at) VALUES ('rss', ?, ?, 1, ?)")
    .run(name, name, nowIso()).lastInsertRowid as number;
}

describe("thread studio", () => {
  beforeEach(resetDb);

  test("draft → edit → posted → the final text enters the voice pool", async () => {
    const entryId = seedMatchedEntry(seedSource("feed-a"), "A matched item");

    // Draft via the stub.
    const draftRes = await app.request(`/api/entries/${entryId}/draft`, { method: "POST" });
    expect(draftRes.status).toBe(200);
    const { thread } = (await draftRes.json()) as { thread: { id: number; draft_json: string } };
    const tweets = JSON.parse(thread.draft_json) as string[];
    expect(tweets).toHaveLength(3);
    expect(
      (db.prepare("SELECT state FROM entries WHERE id = ?").get(entryId) as { state: string }).state,
    ).toBe("drafted");

    // Edit.
    const edited = [...tweets.slice(0, 2), "My hand-written closing tweet."];
    expect(
      (
        await app.request(`/api/threads/${thread.id}`, {
          method: "PUT", headers: json, body: JSON.stringify({ draft_json: edited }),
        })
      ).status,
    ).toBe(200);

    // Posted: current edit becomes final_text; entry flips to posted.
    expect((await app.request(`/api/threads/${thread.id}/posted`, { method: "POST" })).status).toBe(200);
    const row = db.prepare("SELECT final_text, posted_at FROM threads WHERE id = ?").get(thread.id) as {
      final_text: string; posted_at: string;
    };
    expect(row.final_text).toContain("My hand-written closing tweet.");
    expect(row.posted_at).toBeTruthy();
    expect((db.prepare("SELECT state FROM entries WHERE id = ?").get(entryId) as { state: string }).state).toBe("posted");

    // The feedback loop closes: the next generation's prompt carries the final verbatim.
    const { prompt, voiceCount } = composeGenerationPrompt({
      title: "Another item", url: null, content: "c", transcript: null, source_label: "rss:other",
    });
    expect(voiceCount).toBe(1);
    expect(prompt).toContain("My hand-written closing tweet.");

    // Unposted (cheap undo) pulls it back out of the pool.
    expect((await app.request(`/api/threads/${thread.id}/unposted`, { method: "POST" })).status).toBe(200);
    expect(composeGenerationPrompt({ title: "x", url: null, content: null, transcript: null, source_label: "s" }).voiceCount).toBe(0);
  }, 20_000);

  test("cluster draft: one thread from all members, postable without an entry", async () => {
    const srcA = seedSource("feed-a");
    const srcB = seedSource("feed-b");
    const e1 = seedMatchedEntry(srcA, "Take one");
    const e2 = seedMatchedEntry(srcB, "Take two");
    const clusterId = db
      .prepare("INSERT INTO clusters (title, slugs, url_keys, first_seen, last_activity) VALUES ('Story', '[]', '[]', ?, ?)")
      .run(nowIso(), nowIso()).lastInsertRowid as number;
    db.prepare("INSERT INTO cluster_entries (cluster_id, entry_id) VALUES (?, ?), (?, ?)").run(clusterId, e1, clusterId, e2);

    const draftRes = await app.request(`/api/clusters/${clusterId}/draft`, { method: "POST" });
    expect(draftRes.status).toBe(200);
    const { thread } = (await draftRes.json()) as { thread: { id: number; entry_id: number | null; cluster_id: number } };
    expect(thread.entry_id).toBeNull();
    expect(thread.cluster_id).toBe(clusterId);

    // GET /api/clusters/:id round-trips cluster, members, thread.
    const detail = (await app.request(`/api/clusters/${clusterId}`).then((r) => r.json())) as {
      cluster: { sources_count: number }; members: unknown[]; thread: { id: number } | null;
    };
    expect(detail.cluster.sources_count).toBe(2);
    expect(detail.members).toHaveLength(2);
    expect(detail.thread?.id).toBe(thread.id);

    // Posting a cluster thread works and leaves member entry states untouched.
    expect((await app.request(`/api/threads/${thread.id}/posted`, { method: "POST" })).status).toBe(200);
    const states = db.prepare("SELECT state FROM entries ORDER BY id").all() as { state: string }[];
    expect(states.every((s) => s.state === "new")).toBe(true);
  }, 20_000);
});
