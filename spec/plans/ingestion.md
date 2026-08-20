# Ingestion — scheduler, fetchers, run history

## What & why

The engine's intake: on every cron firing (or "Run now"), fetch new entries from all active sources with retries and full per-source accounting. Exists so the owner never babysits polling — and when something breaks, the Runs page says exactly what and why.

## Behavior

- **Scheduler:** `Bun.cron` job from the interval setting (`Every 15 min|30 min|hour|3 hours` → cron expression). Changing the setting stops the old handle and registers a new one. Manual trigger runs the identical `runOnce()`.
- **Per run:** create `runs` row → for each active source (isolated try/catch): fetch → dedupe by `(source_id, external_id)` → insert new entries as `filter_status=pending, state=new` → record `run_sources` row (counts, duration, attempts, status, error_text) → finalize `runs` totals. One source failing never affects the others (see the failed `yt:@fireship` row alongside OK rows in the mockup).
- **Retries:** up to 3 attempts per source, backoff between attempts; each attempt appended to a human-readable trace stored in `error_text` on failure (mockup shows the target format: timestamped attempts, session IDs, "giving up after 3 attempts"). YouTube-protected calls get a **fresh Floxy session per attempt**.
- **Fetchers** (`fetch(source) → NewEntry[]`, each in its own file):
  - **RSS** — fetch + tolerant XML parse (RSS 2.0 + Atom); external_id = guid/link; content = summary.
  - **Hacker News** — Firebase API `topstories` (front-page slice, e.g. top 30) + item fetch; external_id = item id; content = title + points + comment count.
  - **YouTube** — detection via `youtube.com/feeds/videos.xml?channel_id=…` (resolve handle → channel_id once at source-add time, store it); external_id = video id. **Transcripts are NOT fetched at ingestion** — only after an entry matches (see [filter-notify.md](filter-notify.md)), via `transcript.ts` through the proxy.
  - **Twitter** — twitter-cli subprocess with `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` env from settings; parse output; external_id = tweet id; skip retweets/replies (open question below).
- **Runs page** ([mockup](../../planning/4-mockups/runs.html)): newest first; header = id, time, source/new/matched counts, duration, status chip (`OK` green / `Retries` amber / `n failed` crimson); expand → per-source table + error trace + plain-language hint linking to the likely fix ("check Floxy settings").
- **Empty state:** no runs yet → "No runs yet — next check at HH:MM" + Run now button.
- **Working state:** a run in progress shows as its own row, live-ish (poll every few seconds while open).

## Architecture mapping

`server/scheduler.ts`, `server/fetchers/*`, `server/proxy/floxy.ts`, `server/routes/runs.ts`, `web/src/pages/Runs.tsx`.

## Edge cases & open questions

- First fetch of a new source: ingest current items but consider them seen — mark all `skipped` with reason "initial import" (avoid blasting Telegram with a channel's back catalog). Only entries after that are filtered normally.
- HN front page: same story re-enters the top repeatedly — dedupe by item id handles it.
- Feed with no dates / reordered items: rely purely on external_id presence, never on timestamps.
- twitter-cli output format may change — parse defensively, fail the source loudly rather than ingest garbage.
- ~~Open: which twitter-cli subcommand/flags~~ **Pinned against the real CLI (2026-08-20):** the binary installs as `twitter`; profile tweets = `twitter user-posts <handle> --json` (envelope `{ok, data: [...]}`; fields `id`, `text`, `isRetweet`, `author.screenName`, `urls[]`, `quotedTweet`); auth check = `twitter whoami --json`. Retweets (`isRetweet`) and replies (leading `@`) are skipped; a quoted tweet's text is appended to content for filter context; the first embedded URL feeds the trending `url_key` (see trending.md).
- Open: HN slice size (top 30 vs full 500) — start with 30, it's a settings-free constant.
