import { appendRunError, db, getSetting, nowIso, setSetting } from "./db/db";
import { latestOccurrence, nextOccurrence, parseScheduleTimes } from "./clock";
import { rssFetcher } from "./fetchers/rss";
import { hackerNewsFetcher } from "./fetchers/hackernews";
import { youtubeFetcher } from "./fetchers/youtube";
import { twitterFetcher } from "./fetchers/twitter";
import { INTERVAL_MS, sourceLabel, type Fetcher, type NewEntry, type SourceRow } from "./fetchers/types";
import { filterEntry } from "./llm/filter";
import { ClaudeUnavailableError } from "./llm/claude";
import { sendMatchDigest } from "./notify/telegram";
import { normalizeUrlKey, trendingPass } from "./trending/cluster";
import { autoDraftPass, autoDraftTrendingPass } from "./drafts";

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

/* ---------- cron scheduling ----------
 * Per-source cadence: one master tick every minute fetches only the sources
 * that are due (last_fetched_at + check_interval <= now). A tick with nothing
 * due creates no run row. "Run now" fetches all active sources. */

let cronJob: { stop(): void } | null = null;

export function registerSchedule(): void {
  if (cronJob) return;
  cronJob = Bun.cron("* * * * *", () => {
    runOnce("cron")
      .catch((err) => console.error("[run] cron run crashed:", err))
      .finally(() => {
        // The daily trending job rides the same tick, after fetch/filter work.
        if (trendingJobDue(Date.now())) {
          runTrendingJob("cron").catch((err) => console.error("[trending] job crashed:", err));
        }
      });
  });
  console.log("[scheduler] master tick registered: every minute, due sources + trending schedule");
}

function intervalMs(source: SourceRow): number {
  return INTERVAL_MS[source.check_interval] ?? INTERVAL_MS["30m"];
}

function timezone(): string {
  return getSetting("timezone") || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function isDue(source: SourceRow, now: number): boolean {
  if (!source.last_fetched_at) return true;
  const lastFetched = Date.parse(source.last_fetched_at);
  const times = source.schedule_times ? parseScheduleTimes(source.schedule_times) : null;
  if (times) {
    // Clock mode: due when a scheduled occurrence has passed since the last
    // fetch. A missed slot (app offline) fires exactly once at boot.
    return latestOccurrence(times, timezone(), now) > lastFetched;
  }
  // Interval mode; 5s slack so a fetch stamped just after a tick doesn't slip a whole minute.
  return now - lastFetched >= intervalMs(source) - 5_000;
}

/** Earliest upcoming per-source due time across active sources. Null when none. */
export function nextRunAt(): string | null {
  const sources = db.prepare("SELECT * FROM sources WHERE active = 1").all() as SourceRow[];
  if (sources.length === 0) return null;
  const now = Date.now();
  const next = Math.min(
    ...sources.map((s) => {
      if (!s.last_fetched_at) return now;
      if (isDue(s, now)) return now;
      const times = s.schedule_times ? parseScheduleTimes(s.schedule_times) : null;
      if (times) return nextOccurrence(times, timezone(), now);
      return Date.parse(s.last_fetched_at) + intervalMs(s);
    }),
  );
  return new Date(Math.max(next, now)).toISOString();
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
  // Every ingested entry is judged — including a source's first fetch and
  // post-clear re-imports (owner's call: full judgment over a silent baseline;
  // the old "initial import" rule is gone, legacy rows keep their reason).
  const insert = db.prepare(
    `INSERT OR IGNORE INTO entries
       (source_id, source_type, source_label, external_id, title, url, content, url_key, filter_status, state, created_at, created_run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'new', ?, ?)`,
  );

  let newCount = 0;
  const now = nowIso();
  db.transaction(() => {
    for (const entry of entries) {
      if (!entry.external_id) continue;
      const result = insert.run(
        source.id, source.type, label, entry.external_id,
        entry.title, entry.url, entry.content,
        normalizeUrlKey(entry.embedded_url ?? entry.url),
        now, runId,
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

  const all = db.prepare("SELECT * FROM sources WHERE active = 1 ORDER BY id").all() as SourceRow[];
  // Cron ticks fetch only due sources; "Run now" fetches everything.
  const sources = trigger === "cron" ? all.filter((s) => isDue(s, Date.now())) : all;
  if (sources.length === 0 && trigger === "cron") return null; // quiet tick, no run row

  const runId = db
    .prepare("INSERT INTO runs (trigger, started_at) VALUES (?, ?)")
    .run(trigger, nowIso()).lastInsertRowid as number;
  currentRunId = runId;
  console.log(`[run] #${runId} started (${trigger}, ${sources.length}/${all.length} sources due)`);

  try {
    for (const source of sources) {
      const startedAt = Date.now();
      // Stamp at fetch start — a crashing source must not become due again next minute.
      db.prepare("UPDATE sources SET last_fetched_at = ? WHERE id = ?").run(nowIso(), source.id);
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
    await autoDraftPass(runId); // tag-triggered auto-drafts; trending drafts belong to the daily job
    finalizeRun(runId);
  } finally {
    currentRunId = null;
  }
  console.log(`[run] #${runId} finished`);
  return runId;
}

// How many claude -p judgments run at once. Serial was fine when only deltas
// were filtered; with first fetches fully judged, a pool keeps runs tolerable.
const FILTER_CONCURRENCY = 3;

/**
 * Judge every pending entry — including leftovers from previous runs — against
 * the taste prompt, FILTER_CONCURRENCY at a time. Abort semantics: a
 * ClaudeUnavailableError stops the pass immediately; 3 errors with no success
 * in between abort it. Unjudged entries stay pending for the next run.
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

  let nextIndex = 0;
  let errorStreak = 0;
  let aborted = false;

  const judgeOne = async (entry: (typeof pending)[number]): Promise<void> => {
    try {
      const verdict = await filterEntry(entry);
      errorStreak = 0;
      db.prepare(
        "UPDATE entries SET filter_status = ?, filter_reason = ?, filtered_at = ?, filtered_run_id = ?, topics = ?, tags = ?, score = ? WHERE id = ?",
      ).run(
        verdict.matched ? "matched" : "skipped", verdict.reason, nowIso(), runId,
        JSON.stringify(verdict.topics), JSON.stringify(verdict.tags), verdict.score, entry.id,
      );
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
        if (!aborted) appendRunError(runId, err.message);
        aborted = true; // systematic — no point trying the rest
        return;
      }
      errorStreak += 1;
      if (errorStreak >= 3 && !aborted) {
        aborted = true;
        appendRunError(runId, `Filter aborted after 3 errors in a row — ${err instanceof Error ? err.message : err}. Entries remain pending and will be re-filtered next run.`);
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (!aborted && nextIndex < pending.length) {
      const entry = pending[nextIndex++];
      await judgeOne(entry);
    }
  };

  await Promise.all(Array.from({ length: Math.min(FILTER_CONCURRENCY, pending.length) }, worker));
}

/**
 * ONE Telegram digest for every matched-but-unnotified entry (anti-spam —
 * never a message per record). Notify only on the new→notified transition —
 * a refilter can never re-notify. Send failure keeps all of them state=new
 * so the digest is resent next run.
 */
async function notifyPass(runId: number): Promise<void> {
  const matches = db
    .prepare("SELECT * FROM entries WHERE filter_status = 'matched' AND state = 'new' ORDER BY id")
    .all() as {
    id: number; title: string; source_label: string; filter_reason: string | null; url: string | null; tags: string | null;
  }[];
  if (matches.length === 0) return;
  try {
    await sendMatchDigest(
      matches.map((entry) => ({ ...entry, tags: entry.tags ? (JSON.parse(entry.tags) as string[]) : [] })),
    );
    const mark = db.prepare("UPDATE entries SET state = 'notified' WHERE id = ? AND state = 'new'");
    db.transaction(() => {
      for (const entry of matches) mark.run(entry.id);
    })();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[notify] digest (${matches.length} matches): ${message}`);
    appendRunError(runId, `Telegram send failed for ${matches.length} match${matches.length === 1 ? "" : "es"}: ${message}`);
  }
}

/* ---------- the daily trending job (own schedule, 2026-08-20) ----------
 * Batch rhythm: at the owner's chosen time(s), cluster the day's entries,
 * announce what's trending, and draft the best clusters. Recorded in run
 * history as trigger='trending'. */

let trendingRunning = false;

function trendingRunTimes(): string[] {
  return parseScheduleTimes(getSetting("trending_run_times") ?? "09:00") ?? ["09:00"];
}

/** Due when a scheduled occurrence (owner's timezone) has passed since the last job. */
export function trendingJobDue(now: number): boolean {
  const occurrence = latestOccurrence(trendingRunTimes(), timezone(), now);
  if (!Number.isFinite(occurrence)) return false;
  const last = getSetting("trending_last_run_at");
  return !last || Date.parse(last) < occurrence;
}

export function trendingJobRunning(): boolean {
  return trendingRunning;
}

export async function runTrendingJob(trigger: "cron" | "manual"): Promise<number | null> {
  if (trendingRunning) return null;
  trendingRunning = true;
  // Stamped at start so a long job can't re-fire on the next tick.
  setSetting("trending_last_run_at", nowIso());
  const runId = db
    .prepare("INSERT INTO runs (trigger, started_at) VALUES ('trending', ?)")
    .run(nowIso()).lastInsertRowid as number;
  console.log(`[trending] job #${runId} started (${trigger})`);
  try {
    await trendingPass(runId); // cluster the window's entries + trending digest
    await autoDraftTrendingPass(runId); // rank clusters, draft the best, draft digest
    finalizeRun(runId);
  } finally {
    trendingRunning = false;
  }
  console.log(`[trending] job #${runId} finished`);
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
