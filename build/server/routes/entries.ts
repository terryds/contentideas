import { Hono } from "hono";
import { db } from "../db/db";
import { nextRunAt } from "../scheduler";

const entries = new Hono();

// Inbox feed. `filter` = all | youtube | twitter | hn | rss | dismissed.
// Until the taste filter lands (M3) every non-dismissed entry is listed; the
// mockup's matched-only view takes over once filter_status is being written.
entries.get("/", (c) => {
  const filter = c.req.query("filter") ?? "all";

  let where = "state != 'dismissed'";
  const params: string[] = [];
  if (filter === "dismissed") {
    where = "state = 'dismissed'";
  } else if (["youtube", "twitter", "hn", "rss"].includes(filter)) {
    where = "state != 'dismissed' AND source_type = ?";
    params.push(filter);
  }

  const rows = db
    .prepare(`SELECT * FROM entries WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 200`)
    .all(...params);

  const counts = db
    .prepare(
      `SELECT source_type, COUNT(*) AS n FROM entries
       WHERE state != 'dismissed' GROUP BY source_type`,
    )
    .all() as { source_type: string; n: number }[];

  const lastRun = db
    .prepare("SELECT * FROM runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1")
    .get();

  return c.json({ entries: rows, counts, lastRun, nextAt: nextRunAt() });
});

entries.get("/:id", (c) => {
  const row = db.prepare("SELECT * FROM entries WHERE id = ?").get(c.req.param("id"));
  if (!row) return c.json({ error: "Entry not found" }, 404);
  const thread = db
    .prepare("SELECT * FROM threads WHERE entry_id = ? ORDER BY id DESC LIMIT 1")
    .get(c.req.param("id"));
  return c.json({ entry: row, thread: thread ?? null });
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
