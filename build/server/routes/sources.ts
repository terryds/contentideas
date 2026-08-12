import { Hono } from "hono";
import { db, nowIso } from "../db/db";
import { fetchFeed } from "../fetchers/rss";
import { resolveChannel, fetchChannelFeed } from "../fetchers/youtube";
import type { SourceRow, SourceType } from "../fetchers/types";

const sources = new Hono();

sources.get("/", (c) => {
  const rows = db
    .prepare(
      `SELECT s.*,
              rs.status AS health_status,
              rs.error_text AS health_error,
              rs.run_id AS health_run_id,
              rs.finished AS last_checked,
              (SELECT COUNT(*) FROM entries e WHERE e.source_id = s.id
                 AND e.created_at > datetime('now', '-7 days')) AS new_7d,
              (SELECT COUNT(*) FROM entries e WHERE e.source_id = s.id
                 AND e.filter_status = 'matched'
                 AND e.filtered_at > datetime('now', '-7 days')) AS matched_7d
       FROM sources s
       LEFT JOIN (
         SELECT rs.*, r.finished_at AS finished,
                ROW_NUMBER() OVER (PARTITION BY rs.source_id ORDER BY rs.run_id DESC) AS rn
         FROM run_sources rs JOIN runs r ON r.id = rs.run_id
       ) rs ON rs.source_id = s.id AND rs.rn = 1
       ORDER BY s.created_at DESC, s.id DESC`,
    )
    .all();
  return c.json({ sources: rows });
});

function normalizeHandle(input: string): string {
  const match = input.trim().match(/@?([A-Za-z0-9_]{1,15})\s*$/);
  if (!match) throw new Error("Enter a handle like @levelsio or an x.com profile URL");
  return `@${match[1]}`;
}

sources.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { type?: SourceType; input?: string };
  const type = body.type;
  const input = (body.input ?? "").trim();
  if (!type || !["youtube", "twitter", "hn", "rss"].includes(type)) {
    return c.json({ error: "Pick a source type" }, 400);
  }

  let handleOrUrl = input;
  let displayName = input;
  let channelId: string | null = null;

  try {
    if (type === "rss") {
      if (!/^https?:\/\//.test(input)) return c.json({ error: "Enter a full feed URL (https://…)" }, 400);
      const feed = await fetchFeed(input); // validates by fetching once
      displayName = feed.title || new URL(input).hostname;
    } else if (type === "hn") {
      handleOrUrl = "https://news.ycombinator.com";
      displayName = "Hacker News front page";
    } else if (type === "twitter") {
      handleOrUrl = normalizeHandle(input);
      displayName = handleOrUrl;
    } else if (type === "youtube") {
      const resolved = await resolveChannel(input);
      channelId = resolved.channelId;
      handleOrUrl = resolved.handle ?? `channel/${channelId}`;
      const feed = await fetchChannelFeed(channelId); // validates the detection feed works
      displayName = feed.title || handleOrUrl;
    }
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
  }

  const dup = db
    .prepare("SELECT id FROM sources WHERE type = ? AND (handle_or_url = ? OR (channel_id IS NOT NULL AND channel_id = ?))")
    .get(type, handleOrUrl, channelId);
  if (dup) return c.json({ error: "That source is already in the list" }, 409);

  const id = db
    .prepare(
      "INSERT INTO sources (type, handle_or_url, display_name, channel_id, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
    )
    .run(type, handleOrUrl, displayName, channelId, nowIso()).lastInsertRowid;
  return c.json({ id, display_name: displayName }, 201);
});

function setActive(id: string, active: number): boolean {
  return db.prepare("UPDATE sources SET active = ? WHERE id = ?").run(active, id).changes > 0;
}

sources.post("/:id/pause", (c) =>
  setActive(c.req.param("id"), 0) ? c.json({ ok: true }) : c.json({ error: "Source not found" }, 404),
);
sources.post("/:id/resume", (c) =>
  setActive(c.req.param("id"), 1) ? c.json({ ok: true }) : c.json({ error: "Source not found" }, 404),
);

sources.delete("/:id", (c) => {
  // Entries and threads survive removal — source_label was denormalized at ingestion.
  const gone = db.prepare("DELETE FROM sources WHERE id = ?").run(c.req.param("id")).changes > 0;
  return gone ? c.json({ ok: true }) : c.json({ error: "Source not found" }, 404);
});

export default sources;
