import { Hono } from "hono";
import { db, nowIso } from "../db/db";
import { generateThread, voiceExamples } from "../llm/generator";

const threads = new Hono();

// POST /api/entries/:id/draft is mounted here (entry-scoped path, thread resource).
threads.post("/entries/:id/draft", async (c) => {
  const entryId = c.req.param("id");
  const entry = db.prepare("SELECT * FROM entries WHERE id = ?").get(entryId) as
    | {
        id: number;
        title: string;
        url: string | null;
        content: string | null;
        transcript: string | null;
        source_label: string;
        source_type: string;
        state: string;
      }
    | null;
  if (!entry) return c.json({ error: "Entry not found" }, 404);

  // YouTube: the transcript fetch is retried here when the on-match fetch failed.
  if (entry.source_type === "youtube" && !entry.transcript) {
    try {
      const { fetchTranscriptForEntry } = await import("../fetchers/transcript");
      const transcript = await fetchTranscriptForEntry(entry as never);
      if (transcript) {
        db.prepare("UPDATE entries SET transcript = ? WHERE id = ?").run(transcript, entry.id);
        entry.transcript = transcript;
      }
    } catch (err) {
      console.error(`[transcript] entry ${entry.id}:`, err);
      // Generation proceeds on title+content; the editor shows transcript status.
    }
  }

  let generated;
  try {
    generated = await generateThread(entry);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
  }

  // Replace-or-create AFTER a successful parse — a failed regenerate never
  // deletes the previous draft.
  const existing = db.prepare("SELECT id FROM threads WHERE entry_id = ?").get(entry.id) as { id: number } | null;
  let threadId: number;
  if (existing) {
    db.prepare("UPDATE threads SET draft_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(generated.tweets), nowIso(), existing.id,
    );
    threadId = existing.id;
  } else {
    threadId = db
      .prepare("INSERT INTO threads (entry_id, draft_json, updated_at) VALUES (?, ?, ?)")
      .run(entry.id, JSON.stringify(generated.tweets), nowIso()).lastInsertRowid as number;
  }
  if (entry.state !== "posted") {
    db.prepare("UPDATE entries SET state = 'drafted' WHERE id = ?").run(entry.id);
  }

  const thread = db.prepare("SELECT * FROM threads WHERE id = ?").get(threadId);
  return c.json({ thread, voiceCount: generated.voiceCount });
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
