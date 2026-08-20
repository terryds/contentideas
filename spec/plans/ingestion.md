# Ingestion — scheduler, fetchers, run history

## What & why

The engine's intake: on every cron firing (or "Run now"), fetch new entries from all active sources with retries and full per-source accounting. Exists so the owner never babysits polling — and when something breaks, the Runs page says exactly what and why.

## Behavior

- **Scheduler** *(reworked 2026-08-20 — per-source cadence)*: scheduling is **per source**, not global. Each source carries its own `check_interval` (15m / 30m / 1h / 3h / 6h / 12h / 24h) and `max_records` (cap on items fetched per check, default 30), both set when adding the source and editable inline on the Sources page. One master `Bun.cron` tick fires **every minute** and fetches only the sources that are *due* (`last_fetched_at + interval <= now`); a tick with nothing due creates no run row. `last_fetched_at` is stamped when a source's fetch starts (a crashing source can't hot-loop every minute). "Run now" fetches **all** active sources regardless of due-ness. The old global schedule setting is gone.
- **Filter concurrency** *(reworked 2026-08-20)*: pending entries are judged by a pool of **3 concurrent `claude -p` calls** (was serial) — first fetches are now fully judged, so serial runtime became unacceptable. Abort semantics preserved: a `ClaudeUnavailableError` stops the pass immediately; 3 errors with no success in between abort it, entries stay pending.
- **Per run:** create `runs` row → for each active source (isolated try/catch): fetch → dedupe by `(source_id, external_id)` → insert new entries as `filter_status=pending, state=new` → record `run_sources` row (counts, duration, attempts, status, error_text) → finalize `runs` totals. One source failing never affects the others (see the failed `yt:@fireship` row alongside OK rows in the mockup).
- **Retries:** up to 3 attempts per source, backoff between attempts; each attempt appended to a human-readable trace stored in `error_text` on failure (mockup shows the target format: timestamped attempts, session IDs, "giving up after 3 attempts"). YouTube-protected calls get a **fresh Floxy session per attempt**.
- **Fetchers** (`fetch(source) → NewEntry[]`, each in its own file):
  - **RSS** — fetch + tolerant XML parse (RSS 2.0 + Atom); external_id = guid/link; content = summary.
  - **Hacker News** — Firebase API `topstories` (front-page slice, e.g. top 30) + item fetch; external_id = item id; content = title + points + comment count.
  - **YouTube** — detection via `youtube.com/feeds/videos.xml?channel_id=…` (resolve handle → channel_id once at source-add time, store it); external_id = video id. **Transcripts are NOT fetched at ingestion** — only after an entry matches (see [filter-notify.md](filter-notify.md)), via `transcript.ts` through the proxy.
  - **Twitter** — twitter-cli subprocess with `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` env from settings; parse output; external_id = tweet id; skip retweets/replies (open question below).
- **Runs page** ([mockup](../../planning/4-mockups/runs.html)): newest first; header = id, time, source/new/matched counts, duration, status chip (`OK` green / `Retries` amber / `n failed` crimson); expand → per-source table + error trace + plain-language hint linking to the likely fix ("check Floxy settings").
- **Per-run entry detail** *(v1.2)*: expanding a run also lists **every entry that run touched** — ingested or filtered — each with its verdict chip (Matched / Skipped / Pending), the filter's full reasoning, and its notification outcome (sent to Telegram / send pending / n.a.). This answers "why didn't X reach my Telegram?" without guesswork: skipped entries show the filter's own words, initial imports are labeled as such, matched-but-unsent entries point at the run error. Entries carry `created_run_id` and `filtered_run_id` (migration) so verdicts are attributable to the run that produced them; leftovers filtered on a later run appear under that later run.
- **Empty state:** no runs yet → "No runs yet — next check at HH:MM" + Run now button.
- **Working state:** a run in progress shows as its own row, live-ish (poll every few seconds while open).

## Architecture mapping

`server/scheduler.ts`, `server/fetchers/*`, `server/proxy/floxy.ts`, `server/routes/runs.ts`, `web/src/pages/Runs.tsx`.

## Edge cases & open questions

- ~~First fetch of a new source: mark all as seen ("initial import")~~ **Removed by owner decision (2026-08-20):** every ingested entry is judged, *including* a source's first fetch and post-clear re-imports. The owner prefers full judgment over a silent baseline, accepting the costs: a new source's first run makes one `claude -p` call per current item (~10s each, serial) and each match pings Telegram. Legacy entries with reason "initial import" still render correctly in run history; trending still excludes them.
- HN front page: same story re-enters the top repeatedly — dedupe by item id handles it.
- Feed with no dates / reordered items: rely purely on external_id presence, never on timestamps.
- twitter-cli output format may change — parse defensively, fail the source loudly rather than ingest garbage.
- ~~Open: which twitter-cli subcommand/flags~~ **Pinned against the real CLI (2026-08-20):** the binary installs as `twitter`; profile tweets = `twitter user-posts <handle> --json` (envelope `{ok, data: [...]}`; fields `id`, `text`, `isRetweet`, `author.screenName`, `urls[]`, `quotedTweet`); auth check = `twitter whoami --json`. Retweets (`isRetweet`) and replies (leading `@`) are skipped; a quoted tweet's text is appended to content for filter context; the first embedded URL feeds the trending `url_key` (see trending.md).
- Open: HN slice size (top 30 vs full 500) — start with 30, it's a settings-free constant.
