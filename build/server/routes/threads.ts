import { Hono } from "hono";
import { db, nowIso } from "../db/db";
import { voiceExamples } from "../llm/generator";
import { draftEntryThread, type DraftableEntry } from "../drafts";

const threads = new Hono();

// GET /api/threads — the Drafts tab: every thread ever drafted, newest first,
// joined with its subject (entry or trending cluster).
threads.get("/threads", (c) => {
  const filter = c.req.query("filter") ?? "all";
  const where =
    filter === "unposted" ? "WHERE t.posted_at IS NULL" : filter === "posted" ? "WHERE t.posted_at IS NOT NULL" : "";
  const rows = db
    .prepare(
      `SELECT t.id, t.entry_id, t.cluster_id, t.draft_json, t.posted_at, t.updated_at,
              COALESCE(e.title, cl.title, '(subject removed)') AS subject_title,
              e.source_label, e.url
       FROM threads t
       LEFT JOIN entries e ON e.id = t.entry_id
       LEFT JOIN clusters cl ON cl.id = t.cluster_id
       ${where}
       ORDER BY t.updated_at DESC, t.id DESC LIMIT 200`,
    )
    .all();
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(posted_at IS NULL), 0) AS unposted,
              COALESCE(SUM(posted_at IS NOT NULL), 0) AS posted
       FROM threads`,
    )
    .get();
  return c.json({ threads: rows, counts });
});

// POST /api/entries/:id/draft is mounted here (entry-scoped path, thread resource).
threads.post("/entries/:id/draft", async (c) => {
  const entry = db.prepare("SELECT * FROM entries WHERE id = ?").get(c.req.param("id")) as DraftableEntry | null;
  if (!entry) return c.json({ error: "Entry not found" }, 404);
  try {
    const result = await draftEntryThread(entry);
    const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(result.threadId);
    return c.json({ thread, voiceCount: result.voiceCount });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

threads.put("/threads/:id", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { draft_json?: unknown } | null;
  if (!body || !Array.isArray(body.draft_json) || !body.draft_json.every((t) => typeof t === "string")) {
    return c.json({ error: "draft_json must be an array of strings" }, 400);
  }
  const changed = db
    .prepare("UPDATE threads SET draft_json = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(body.draft_json), nowIso(), c.req.param("id")).changes;
  return changed ? c.json({ ok: true }) : c.json({ error: "Thread not found" }, 404);
});

// Mark as posted: the current edited text becomes a voice example.
threads.post("/threads/:id/posted", (c) => {
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(c.req.param("id")) as
    | { id: number; entry_id: number | null; draft_json: string }
    | null;
  if (!thread) return c.json({ error: "Thread not found" }, 404);
  const tweets = JSON.parse(thread.draft_json) as string[];
  const finalText = tweets.join("\n\n");
  db.prepare("UPDATE threads SET final_text = ?, posted_at = ?, updated_at = ? WHERE id = ?").run(
    finalText, nowIso(), nowIso(), thread.id,
  );
  // Cluster threads (entry_id null) have no single entry; members keep their states.
  if (thread.entry_id !== null) {
    db.prepare("UPDATE entries SET state = 'posted' WHERE id = ?").run(thread.entry_id);
  }
  return c.json({ ok: true, voicePoolSize: voiceExamples().length });
});

// Cheap undo (spec open question, included since trivial).
threads.post("/threads/:id/unposted", (c) => {
  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(c.req.param("id")) as
    | { id: number; entry_id: number | null }
    | null;
  if (!thread) return c.json({ error: "Thread not found" }, 404);
  db.prepare("UPDATE threads SET final_text = NULL, posted_at = NULL, updated_at = ? WHERE id = ?").run(
    nowIso(), thread.id,
  );
  if (thread.entry_id !== null) {
    db.prepare("UPDATE entries SET state = 'drafted' WHERE id = ?").run(thread.entry_id);
  }
  return c.json({ ok: true });
});

export default threads;
