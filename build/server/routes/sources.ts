import { Hono } from "hono";
import { db, nowIso } from "../db/db";
import { fetchFeed } from "../fetchers/rss";
import { resolveChannel, fetchChannelFeed } from "../fetchers/youtube";
import { INTERVAL_MS, MAX_RECORDS_LIMIT, type SourceRow, type SourceType } from "../fetchers/types";
import { MAX_SCHEDULE_TIMES, parseScheduleTimes } from "../clock";

function validCadence(interval: unknown, maxRecords: unknown, scheduleTimes: unknown): string | null {
  if (interval !== undefined && !(typeof interval === "string" && interval in INTERVAL_MS)) {
    return `Interval must be one of ${Object.keys(INTERVAL_MS).join(", ")}`;
  }
  if (maxRecords !== undefined) {
    const n = Number(maxRecords);
    if (!Number.isInteger(n) || n < 1 || n > MAX_RECORDS_LIMIT) {
      return `Max records must be a whole number from 1 to ${MAX_RECORDS_LIMIT}`;
    }
  }
  // schedule_times: "" clears (interval mode); otherwise comma-separated HH:MM.
  if (scheduleTimes !== undefined && scheduleTimes !== "" && scheduleTimes !== null) {
    if (typeof scheduleTimes !== "string" || !parseScheduleTimes(scheduleTimes)) {
      return `Times must be comma-separated HH:MM (24h), up to ${MAX_SCHEDULE_TIMES} — e.g. "07:00, 19:00"`;
    }
  }
  return null;
}

function normalizeTimes(scheduleTimes: string | null | undefined): string | null {
  if (!scheduleTimes) return null;
  return parseScheduleTimes(scheduleTimes)?.join(",") ?? null;
}

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
  const body = (await c.req.json().catch(() => ({}))) as {
    type?: SourceType;
    input?: string;
    check_interval?: string;
    max_records?: number;
    schedule_times?: string;
  };
  const type = body.type;
  const input = (body.input ?? "").trim();
  if (!type || !["youtube", "twitter", "hn", "rss"].includes(type)) {
    return c.json({ error: "Pick a source type" }, 400);
  }
  const cadenceError = validCadence(body.check_interval, body.max_records, body.schedule_times);
  if (cadenceError) return c.json({ error: cadenceError }, 400);
  const checkInterval = body.check_interval ?? "30m";
  const maxRecords = body.max_records ?? 30;
  const scheduleTimes = normalizeTimes(body.schedule_times);

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
      "INSERT INTO sources (type, handle_or_url, display_name, channel_id, active, created_at, check_interval, max_records, schedule_times) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)",
    )
    .run(type, handleOrUrl, displayName, channelId, nowIso(), checkInterval, maxRecords, scheduleTimes).lastInsertRowid;
  return c.json({ id, display_name: displayName }, 201);
});

// Inline cadence editing from the Sources table (v1.2). Sending schedule_times
// switches the source to clock mode; sending "" clears it back to its interval.
sources.put("/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    check_interval?: string;
    max_records?: number;
    schedule_times?: string;
  };
  if (body.check_interval === undefined && body.max_records === undefined && body.schedule_times === undefined) {
    return c.json({ error: "Send check_interval, max_records, and/or schedule_times" }, 400);
  }
  const cadenceError = validCadence(body.check_interval, body.max_records, body.schedule_times);
  if (cadenceError) return c.json({ error: cadenceError }, 400);
  const existing = db.prepare("SELECT * FROM sources WHERE id = ?").get(c.req.param("id")) as SourceRow | null;
  if (!existing) return c.json({ error: "Source not found" }, 404);
  const scheduleTimes =
    body.schedule_times === undefined ? existing.schedule_times : normalizeTimes(body.schedule_times);
  db.prepare("UPDATE sources SET check_interval = ?, max_records = ?, schedule_times = ? WHERE id = ?").run(
    body.check_interval ?? existing.check_interval,
    body.max_records ?? existing.max_records,
    scheduleTimes,
    existing.id,
  );
  return c.json({ ok: true });
});

// Per-source manual run (v1.2): full pipeline, scoped to one source.
sources.post("/:id/run", async (c) => {
  const source = db.prepare("SELECT * FROM sources WHERE id = ?").get(c.req.param("id")) as SourceRow | null;
  if (!source) return c.json({ error: "Source not found" }, 404);
  if (!source.active) return c.json({ error: "Source is paused — resume it first" }, 400);
  const { runOnce, runningRunId } = await import("../scheduler");
  if (runningRunId() !== null) return c.json({ runId: runningRunId(), alreadyRunning: true });
  // runOnce inserts the run row synchronously before its first await.
  runOnce("manual", source.id).catch((err) => console.error("[run] per-source run crashed:", err));
  return c.json({ runId: runningRunId(), alreadyRunning: false });
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
