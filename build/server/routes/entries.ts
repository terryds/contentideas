import { Hono } from "hono";
import { db } from "../db/db";
import { nextRunAt } from "../scheduler";
import { activeClusters } from "../trending/cluster";

const entries = new Hono();

// Inbox feed — everything the taste filter matched. `filter` = all | youtube |
// twitter | hn | rss | dismissed (dismissed hidden from every other view).
entries.get("/", (c) => {
  const filter = c.req.query("filter") ?? "all";

  let where = "filter_status = 'matched' AND state != 'dismissed'";
  const params: string[] = [];
  if (filter === "dismissed") {
    where = "state = 'dismissed'";
  } else if (["youtube", "twitter", "hn", "rss"].includes(filter)) {
    where = "filter_status = 'matched' AND state != 'dismissed' AND source_type = ?";
    params.push(filter);
  } else if (filter.startsWith("tag:")) {
    where =
      "filter_status = 'matched' AND state != 'dismissed' AND EXISTS (SELECT 1 FROM json_each(COALESCE(entries.tags, '[]')) WHERE json_each.value = ?)";
    params.push(filter.slice(4));
  }

  const rows = db
    .prepare(`SELECT * FROM entries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 200`)
    .all(...params);

  const counts = db
    .prepare(
      `SELECT source_type, COUNT(*) AS n FROM entries
       WHERE filter_status = 'matched' AND state != 'dismissed' GROUP BY source_type`,
    )
    .all() as { source_type: string; n: number }[];

  const tagCounts = db
    .prepare(
      `SELECT je.value AS tag, COUNT(*) AS n
       FROM entries e, json_each(COALESCE(e.tags, '[]')) je
       WHERE e.filter_status = 'matched' AND e.state != 'dismissed'
       GROUP BY je.value ORDER BY n DESC, tag`,
    )
    .all() as { tag: string; n: number }[];

  const lastRun = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM run_sources rs WHERE rs.run_id = r.id) AS sources_count,
              (SELECT COUNT(*) FROM entries e WHERE e.filtered_at >= r.started_at) AS filtered_count
       FROM runs r WHERE r.finished_at IS NOT NULL ORDER BY r.id DESC LIMIT 1`,
    )
    .get();

  // M7: trending clusters ride on the inbox payload (shown on the "all" view).
  return c.json({ entries: rows, counts, tagCounts, lastRun, nextAt: nextRunAt(), clusters: activeClusters() });
});

entries.get("/:id", (c) => {
  const row = db.prepare("SELECT * FROM entries WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "Entry not found" }, 404);
  const thread = db
    .prepare("SELECT * FROM threads WHERE entry_id = ? ORDER BY id DESC LIMIT 1")
    .get(c.req.param("id"));
  const pool = db
    .prepare("SELECT COUNT(*) AS n FROM threads WHERE final_text IS NOT NULL AND posted_at IS NOT NULL")
    .get() as { n: number };
  const configured = Number(
    (db.prepare("SELECT value FROM settings WHERE key = 'voice_examples_count'").get() as { value: string } | null)
      ?.value ?? "5",
  );
  return c.json({ entry: row, thread: thread ?? null, voiceCount: Math.min(pool.n, configured) });
});

entries.post("/:id/dismiss", (c) => {
  const changed = db
    .prepare("UPDATE entries SET state = 'dismissed' WHERE id = ?")
    .run(c.req.param("id")).changes;
  return changed ? c.json({ ok: true }) : c.json({ error: "Entry not found" }, 404);
});

// Reversible from the Dismissed filter view.
entries.post("/:id/restore", (c) => {
  const row = db.prepare("SELECT id FROM threads WHERE entry_id = ? AND posted_at IS NOT NULL").get(c.req.param("id"));
  const draft = db.prepare("SELECT id FROM threads WHERE entry_id = ?").get(c.req.param("id"));
  const state = row ? "posted" : draft ? "drafted" : "new";
  const changed = db
    .prepare("UPDATE entries SET state = ? WHERE id = ? AND state = 'dismissed'")
    .run(state, c.req.param("id")).changes;
  return changed ? c.json({ ok: true }) : c.json({ error: "Entry not found or not dismissed" }, 404);
});

export default entries;
