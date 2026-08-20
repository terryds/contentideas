import { appendRunError, db, getSetting, nowIso } from "./db/db";
import { rssFetcher } from "./fetchers/rss";
import { hackerNewsFetcher } from "./fetchers/hackernews";
import { youtubeFetcher } from "./fetchers/youtube";
import { twitterFetcher } from "./fetchers/twitter";
import { sourceLabel, type Fetcher, type NewEntry, type SourceRow } from "./fetchers/types";
import { filterEntry } from "./llm/filter";
import { ClaudeUnavailableError } from "./llm/claude";
import { sendMatch } from "./notify/telegram";
import { normalizeUrlKey, trendingPass } from "./trending/cluster";

// New source types register here (plus a type-select option in the Sources UI).
const fetchers: Partial<Record<SourceRow["type"], Fetcher>> = {
  rss: rssFetcher,
  hn: hackerNewsFetcher,
  youtube: youtubeFetcher,
  twitter: twitterFetcher,
};

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [0, 2_000, 5_000];

let currentRunId: number | null = null;

/* ---------- cron scheduling ---------- */

// "1m" is a hidden test value (not offered in the UI) used to verify unattended runs.
const INTERVAL_CRON: Record<string, string> = {
  "1m": "* * * * *",
  "15m": "*/15 * * * *",
  "30m": "*/30 * * * *",
  "1h": "0 * * * *",
  "3h": "0 */3 * * *",
};
let cronJob: { stop(): void } | null = null;
let currentInterval: string | null = null;

export function registerSchedule(): void {
  const interval = getSetting("check_interval") ?? "30m";
  const expression = INTERVAL_CRON[interval] ?? INTERVAL_CRON["30m"];
  if (cronJob && currentInterval === interval) return;
  cronJob?.stop();
  cronJob = Bun.cron(expression, () => {
    runOnce("cron").catch((err) => console.error("[run] cron run crashed:", err));
  });
  currentInterval = interval;
  console.log(`[scheduler] cron registered: every ${interval} (${expression})`);
}

/** Next cron firing. Null when nothing is scheduled. */
export function nextRunAt(): string | null {
  const expression = INTERVAL_CRON[currentInterval ?? ""];
  if (!expression) return null;
  return Bun.cron.parse(expression)?.toISOString() ?? null;
}

/** Called by the settings route after a save; re-registers cron when the interval changes. */
export function onSettingsChanged(changed: Record<string, string>): void {
  if ("check_interval" in changed) registerSchedule();
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

async function fetchWithRetries(source: SourceRow, runId: number): Promise<SourceResult> {
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
      const newCount = insertEntries(source, entries, runId);
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
function insertEntries(source: SourceRow, entries: NewEntry[], runId: number): number {
  const label = sourceLabel(source);
  const firstFetch =
    (db.prepare("SELECT COUNT(*) AS n FROM entries WHERE source_id = ?").get(source.id) as { n: number }).n === 0;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO entries
       (source_id, source_type, source_label, external_id, title, url, content, url_key, filter_status, filter_reason, filtered_at, state, created_at, created_run_id, filtered_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
  );

  let newCount = 0;
  const now = nowIso();
  db.transaction(() => {
    for (const entry of entries) {
      if (!entry.external_id) continue;
      // First fetch of a new source: ingest the current items but consider them seen —
      // avoids blasting Telegram with a channel's back catalog.
      const [filterStatus, filterReason, filteredAt, filteredRunId] = firstFetch
        ? ["skipped", "initial import", now, runId]
        : ["pending", null, null, null];
      const result = insert.run(
        source.id, source.type, label, entry.external_id,
        entry.title, entry.url, entry.content,
        normalizeUrlKey(entry.embedded_url ?? entry.url),
        filterStatus, filterReason, filteredAt, now, runId, filteredRunId,
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
        result = await fetchWithRetries(source, runId);
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

    await filterPass(runId);
    await notifyPass(runId);
    await trendingPass(runId); // M7 — after individual pings; degrades the run, never fails it
    finalizeRun(runId);
  } finally {
    currentRunId = null;
  }
  console.log(`[run] #${runId} finished`);
  return runId;
}

/**
 * Judge every pending entry — including leftovers from previous runs — against
 * the taste prompt. Serial on purpose (keeps `claude -p` load sane; a busy
 * first run taking minutes is acceptable and visible in run duration).
 */
async function filterPass(runId: number): Promise<void> {
  const pending = db
    .prepare("SELECT * FROM entries WHERE filter_status = 'pending' ORDER BY id")
    .all() as {
    id: number;
    source_id: number;
    source_type: string;
    external_id: string;
    url: string | null;
    title: string;
    source_label: string;
    content: string | null;
    transcript: string | null;
  }[];
  if (pending.length === 0) return;

  let consecutiveErrors = 0;
  for (const entry of pending) {
    try {
      const verdict = await filterEntry(entry);
      consecutiveErrors = 0;
      db.prepare(
        "UPDATE entries SET filter_status = ?, filter_reason = ?, filtered_at = ?, filtered_run_id = ?, topics = ? WHERE id = ?",
      ).run(verdict.matched ? "matched" : "skipped", verdict.reason, nowIso(), runId, JSON.stringify(verdict.topics), entry.id);
      if (verdict.matched) {
        // Attribute the match to this run's row for the entry's source (may be
        // absent if the source was since paused/removed — that's fine).
        db.prepare(
          "UPDATE run_sources SET matched_count = matched_count + 1 WHERE run_id = ? AND source_id = ?",
        ).run(runId, entry.source_id);
        // YouTube: fetch the transcript now, through the proxy. Failure never
        // blocks the Telegram ping — drafting retries the fetch later.
        if (entry.source_type === "youtube" && !entry.transcript) {
          try {
            const { fetchTranscriptForEntry } = await import("./fetchers/transcript");
            const transcript = await fetchTranscriptForEntry(entry);
            if (transcript) {
              db.prepare("UPDATE entries SET transcript = ? WHERE id = ?").run(transcript, entry.id);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[transcript] entry ${entry.id}: ${message}`);
            appendRunError(runId, `Transcript fetch failed for "${entry.title.slice(0, 60)}":\n${message}\nWill retry when the thread is drafted.`);
          }
        }
      }
    } catch (err) {
      // Unparseable/errored verdict: entry stays pending, picked up next run.
      console.error(`[filter] entry ${entry.id}:`, err);
      if (err instanceof ClaudeUnavailableError) {
        appendRunError(runId, err.message);
        return; // systematic — no point trying the rest
      }
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) {
        appendRunError(runId, `Filter aborted after 3 consecutive errors — ${err instanceof Error ? err.message : err}. Entries remain pending and will be re-filtered next run.`);
        return;
      }
    }
  }
}

/**
 * Telegram ping for every matched-but-unnotified entry. Notify only on the
 * new→notified transition — a refilter can never re-notify. Send failure keeps
 * state=new so it's resent next run.
 */
async function notifyPass(runId: number): Promise<void> {
  const matches = db
    .prepare("SELECT * FROM entries WHERE filter_status = 'matched' AND state = 'new' ORDER BY id")
    .all() as { id: number; title: string; source_label: string; filter_reason: string | null; url: string | null }[];
  for (const entry of matches) {
    try {
      await sendMatch(entry);
      db.prepare("UPDATE entries SET state = 'notified' WHERE id = ? AND state = 'new'").run(entry.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[notify] entry ${entry.id}: ${message}`);
      appendRunError(runId, `Telegram send failed for "${entry.title.slice(0, 60)}": ${message}`);
      if (/not configured/i.test(message)) return; // no creds — every send would fail
    }
  }
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
