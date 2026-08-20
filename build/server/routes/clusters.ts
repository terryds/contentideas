// M7 trending clusters: detail for the cluster editor, dismiss, and
// draft-from-cluster (one thread from every member's material).

import { Hono } from "hono";
import { db, nowIso } from "../db/db";
import { distinctSourceCount, type ClusterRow } from "../trending/cluster";
import { generateClusterThread, voiceExamples } from "../llm/generator";

const clusters = new Hono();

interface MemberEntry {
  id: number;
  title: string;
  url: string | null;
  content: string | null;
  transcript: string | null;
  source_label: string;
  source_type: string;
  filter_status: string;
  filter_reason: string | null;
  state: string;
}

function fullMembers(clusterId: number): MemberEntry[] {
  return db
    .prepare(
      `SELECT e.id, e.title, e.url, e.content, e.transcript, e.source_label, e.source_type,
              e.filter_status, e.filter_reason, e.state
       FROM cluster_entries ce JOIN entries e ON e.id = ce.entry_id
       WHERE ce.cluster_id = ? ORDER BY e.id`,
    )
    .all(clusterId) as MemberEntry[];
}

clusters.get("/:id", (c) => {
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(c.req.param("id")) as ClusterRow | null;
  if (!cluster) return c.json({ error: "Cluster not found" }, 404);
  const thread = db
    .prepare("SELECT * FROM threads WHERE cluster_id = ? ORDER BY id DESC LIMIT 1")
    .get(cluster.id);
  const pool = db
    .prepare("SELECT COUNT(*) AS n FROM threads WHERE final_text IS NOT NULL AND posted_at IS NOT NULL")
    .get() as { n: number };
  const configured = Number(
    (db.prepare("SELECT value FROM settings WHERE key = 'voice_examples_count'").get() as { value: string } | null)
      ?.value ?? "5",
  );
  return c.json({
    cluster: { ...cluster, sources_count: distinctSourceCount(cluster.id) },
    members: fullMembers(cluster.id),
    thread: thread ?? null,
    voiceCount: Math.min(pool.n, configured),
  });
});

clusters.post("/:id/dismiss", (c) => {
  const changed = db
    .prepare("UPDATE clusters SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL")
    .run(nowIso(), c.req.param("id")).changes;
  return changed ? c.json({ ok: true }) : c.json({ error: "Cluster not found or already dismissed" }, 404);
});

clusters.post("/:id/draft", async (c) => {
  const cluster = db.prepare("SELECT * FROM clusters WHERE id = ?").get(c.req.param("id")) as ClusterRow | null;
  if (!cluster) return c.json({ error: "Cluster not found" }, 404);
  const members = fullMembers(cluster.id);
  if (members.length === 0) return c.json({ error: "Cluster has no member entries" }, 400);

  // YouTube members without a transcript get one retry here, same as entry drafts.
  for (const member of members) {
    if (member.source_type === "youtube" && !member.transcript) {
      try {
        const { fetchTranscriptForEntry } = await import("../fetchers/transcript");
        const transcript = await fetchTranscriptForEntry(member as never);
        if (transcript) {
          db.prepare("UPDATE entries SET transcript = ? WHERE id = ?").run(transcript, member.id);
          member.transcript = transcript;
        }
      } catch (err) {
        console.error(`[transcript] entry ${member.id}:`, err);
        // Generation proceeds on the other material.
      }
    }
  }

  let generated;
  try {
    generated = await generateClusterThread(members);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }

  // Replace-or-create AFTER a successful parse — same guarantee as entry drafts.
  const existing = db.prepare("SELECT id FROM threads WHERE cluster_id = ?").get(cluster.id) as { id: number } | null;
  let threadId: number;
  if (existing) {
    db.prepare("UPDATE threads SET draft_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(generated.tweets), nowIso(), existing.id,
    );
    threadId = existing.id;
  } else {
    threadId = db
      .prepare("INSERT INTO threads (cluster_id, draft_json, updated_at) VALUES (?, ?, ?)")
      .run(cluster.id, JSON.stringify(generated.tweets), nowIso()).lastInsertRowid as number;
  }

  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId);
  return c.json({ thread, voiceCount: generated.voiceCount });
});

export default clusters;
