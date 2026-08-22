// M7 trending clusters: detail for the cluster editor, dismiss, and
// draft-from-cluster (one thread from every member's material).

import { Hono } from "hono";
import { db, nowIso } from "../db/db";
import { distinctSourceCount, type ClusterRow } from "../trending/cluster";
import { draftClusterThread, fullClusterMembers } from "../drafts";

const clusters = new Hono();

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
    members: fullClusterMembers(cluster.id),
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
  try {
    const result = await draftClusterThread(cluster.id);
    const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(result.threadId);
    return c.json({ thread, voiceCount: result.voiceCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, /no member entries/.test(message) ? 400 : 502);
  }
});

export default clusters;
