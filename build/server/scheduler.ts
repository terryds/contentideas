import { db, nowIso } from "./db/db";
import { rssFetcher } from "./fetchers/rss";
import { sourceLabel, type Fetcher, type SourceRow } from "./fetchers/types";

// New source types register here (plus a type-select option in the Sources UI).
const fetchers: Partial<Record<SourceRow["type"], Fetcher>> = {
  rss: rssFetcher,
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2_000, 5_000];

let currentRunId: number | null = null;

/** Called by the settings route after a save; re-registers cron when the interval changes (M1). */
export function onSettingsChanged(changed: Record<string, string>): void {
  if ("check_interval" in changed) {
    console.log(`[scheduler] interval changed to ${changed.check_interval}`);
  }
}

export function runningRunId(): number | null {
  return currentRunId;
}

function timeStamp(): string {
  return new Date().toISOString().slice(11, 19);
}

interface SourceResult {
  newCount: number;
  attempts: number;
  status: "ok" | "retrying" | "failed";
  errorText: string | null;
}

async function fetchWithRetries(source: SourceRow): Promise<SourceResult> {
  const fetcher = fetchers[source.type];
  if (!fetcher) {
    return {
      newCount: 0,
      attempts: 0,
      status: "failed",
      errorText: `No fetcher for source type "${source.type}" yet — arrives in a later milestone`,
    };
  }

  const trace: string[] = [];
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1]) await Bun.sleep(BACKOFF_MS[attempt - 1]);
    try {
      const entries = await fetcher.fetch(source);
      const newCount = insertEntries(source, entries);
      return {
        newCount,
        attempts: attempt,
        status: attempt === 1 ? "ok" : "retrying",
        errorText: attempt === 1 ? null : [lastErrorHeader(lastError), ...trace, `succeeded on attempt ${attempt}`].join("\n"),
      };
    } catch (err) {
      lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      trace.push(`  attempt ${attempt}  ${timeStamp()}  → ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return {
    newCount: 0,
    attempts: MAX_ATTEMPTS,
    status: "failed",
    errorText: [lastErrorHeader(lastError), ...trace, `  giving up after ${MAX_ATTEMPTS} attempts`].join("\n"),
  };
}

function lastErrorHeader(error: string): string {
  return error || "Error";
}

/** Insert fetched entries, deduped by (source_id, external_id). Returns how many were actually new. */
function insertEntries(source: SourceRow, entries: { external_id: string; title: string; url: string; content: string }[]): number {
  const label = sourceLabel(source);
  const firstFetch =
    (db.prepare("SELECT COUNT(*) AS n FROM entries WHERE source_id = ?").get(source.id) as { n: number }).n === 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO entries
       (source_id, source_type, source_label, external_id, title, url, content, filter_status, filter_reason, filtered_at, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
  );

  let newCount = 0;
  const now = nowIso();
  db.transaction(() => {
    for (const entry of entries) {
      if (!entry.external_id) continue;
      // First fetch of a new source: ingest the current items but consider them seen —
      // avoids blasting Telegram with a channel's back catalog.
      const [filterStatus, filterReason, filteredAt] = firstFetch
        ? ["skipped", "initial import", now]
        : ["pending", null, null];
      const result = insert.run(
        source.id, source.type, label, entry.external_id,
        entry.title, entry.url, entry.content,
        filterStatus, filterReason, filteredAt, now,
      );
      newCount += result.changes;
    }
  })();
  return newCount;
}

export async function runOnce(trigger: "cron" | "manual"): Promise<number | null> {
  if (currentRunId !== null) {
    console.log(`[run] run #${currentRunId} already in progress — skipping ${trigger} trigger`);
    return null;
  }

  const runId = db
    .prepare("INSERT INTO runs (trigger, started_at) VALUES (?, ?)")
    .run(trigger, nowIso()).lastInsertRowid as number;
  currentRunId = runId;
  console.log(`[run] #${runId} started (${trigger})`);

  try {
    const sources = db
      .prepare("SELECT * FROM sources WHERE active = 1 ORDER BY id")
      .all() as SourceRow[];

    for (const source of sources) {
      const startedAt = Date.now();
      // One source failing must never affect the others.
      let result: SourceResult;
      try {
        result = await fetchWithRetries(source);
      } catch (err) {
        result = {
          newCount: 0,
          attempts: MAX_ATTEMPTS,
          status: "failed",
          errorText: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
        };
      }
      db.prepare(
        `INSERT INTO run_sources (run_id, source_id, source_label, new_count, matched_count, duration_ms, attempts, status, error_text)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(runId, source.id, sourceLabel(source), result.newCount, Date.now() - startedAt, result.attempts, result.status, result.errorText);
    }

    finalizeRun(runId);
  } finally {
    currentRunId = null;
  }
  console.log(`[run] #${runId} finished`);
  return runId;
}

function finalizeRun(runId: number): void {
  const totals = db
    .prepare(
      `SELECT COALESCE(SUM(new_count), 0) AS new_total,
              COALESCE(SUM(matched_count), 0) AS matched_total,
              COALESCE(SUM(status = 'failed'), 0) AS failed_total
       FROM run_sources WHERE run_id = ?`,
    )
    .get(runId) as { new_total: number; matched_total: number; failed_total: number };
  db.prepare(
    "UPDATE runs SET finished_at = ?, new_count = ?, matched_count = ?, failed_count = ? WHERE id = ?",
  ).run(nowIso(), totals.new_total, totals.matched_total, totals.failed_total, runId);
}
