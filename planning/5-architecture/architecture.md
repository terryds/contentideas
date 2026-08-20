Status: done

# Architecture

One Bun process serves everything: the JSON API, the built React dashboard, and the in-process scheduler. A separate Vite build step produces the SPA assets. Single user, binds to `127.0.0.1` only.

## Components

### Backend (Bun + Hono, one process)

- **API server** — Hono routes under `/api/*`; serves the built React assets statically for every other path.
- **Scheduler** — in-process via native **`Bun.cron`** (verified present in Bun 1.3.12; returns a handle with `stop()`, plus `Bun.cron.parse()` for validation): the interval setting maps to a cron expression (e.g. every 30 min → `*/30 * * * *`), and changing the setting stops the old job and registers a new one. Each firing creates a `runs` row and works through all active sources. Per-source isolation: each source is fetched/filtered inside its own try/catch with its own `run_sources` row — one source failing never blocks the rest. "Run now" in the UI triggers the same code path.
- **Fetchers** — one module per source type behind a common interface `fetch(source) → NewEntry[]`:
  - `youtube.ts` — new-video *detection* via the channel's RSS feed (`youtube.com/feeds/videos.xml?channel_id=…`, cheap and rarely bot-protected); *transcript fetching* for matched videos goes through the **Floxy residential proxy with a fresh session (new IP) per attempt**. Transcript library chosen by trial and error during the build (candidates: `youtubei.js`, `youtube-transcript`, `yt-dlp` subprocess) — isolated behind `getTranscript(videoId)` so swapping libraries touches one file.
  - `twitter.ts` — spawns **twitter-cli** as a subprocess with `TWITTER_AUTH_TOKEN` + `TWITTER_CT0` env vars from settings; parses its output into entries.
  - `hackernews.ts` — official Firebase API (`topstories` + items); no scraping, no proxy.
  - `rss.ts` — plain fetch + tolerant XML parsing.
  - **Retries**: up to 3 attempts per source with backoff; YouTube gets a fresh proxy session each attempt. Attempts are recorded on the `run_sources` row (the Runs mockup's "attempt 1/2/3" trace).
- **Filter** — runs `claude -p` as a subprocess once per new entry: taste prompt (settings) + entry title/summary → `MATCH`/`SKIP` + one-line reason, parsed defensively (retry once on unparseable output). Verdict + reason stored on the entry. If the filter call itself fails, the entry stays `pending` and is re-filtered next run — nothing is lost.
- **Notifier** — Telegram Bot API `sendMessage` (bot token + chat ID from settings): title, source, the filter's reason, original link. Send failures are recorded on the entry and retried next run.
- **Generator** — on "Draft thread": `claude -p` with the generation prompt (settings) + item content (transcript for YouTube, tweet text for X, title/URL for HN/RSS) + the **last N posted finals as voice examples** (N from settings). Must return JSON (array of tweet strings); parsed defensively, one retry. "Regenerate" repeats this; edits happen client-side and save to the draft.

### Frontend (React SPA, Vite)

Five routes matching the five mockups: `/` inbox, `/item/:id` editor, `/sources`, `/runs`, `/settings`. Talks only to `/api/*`. No SSR; the styleguide tokens become the SPA's CSS.

- **Trending clusterer** *(v1.1)* — runs in the pipeline after filtering. Identity is two-tier: exact match on **normalized URLs** (strip `utm_*`/`ref`/`fbclid`/`gclid`, fragments, `www.`, trailing slash) or **topic-slug overlap ≥ 2** — the topic slugs come from the *same* `claude -p` filter call, extended to also return 2–4 canonical slugs per entry (no extra API calls). An entry joins the most recent cluster active within 48h that satisfies either test, else starts a new one. When a cluster's **distinct-source count** reaches the threshold (settings, default 2), the notifier sends one "trending across your sources" Telegram message — once per cluster, regardless of the taste verdicts of its members. Initial-import entries never join clusters.

## Data & storage

SQLite via `bun:sqlite`, one local file. No sync, no accounts.

- `sources` — type (`youtube|twitter|hn|rss`), handle/URL, display name, active flag, timestamps.
- `entries` — source_id, external_id (dedupe key: **unique on source_id + external_id**), title, url, content (tweet text / summary), transcript (nullable, fetched on match), filter fields (`status: pending|matched|skipped`, reason, filtered_at), lifecycle (`state: new|notified|drafted|posted|dismissed`).
- `threads` — entry_id, draft_json (array of tweets), final_text (filled on "mark as posted"), posted_at. Posted rows are the few-shot voice pool.
- `runs` — started_at, finished_at, trigger (`cron|manual`), totals.
- `run_sources` — run_id, source_id, counts, duration, attempts, status (`ok|retrying|failed`), error_text. Powers both the Runs page and the Sources health column (health = latest run_sources row per source).
- `clusters` *(v1.1)* — canonical title (first member's), topic slugs (union), url_keys, first/last activity, notified_at (nullable).
- `cluster_entries` *(v1.1)* — cluster_id, entry_id. `entries` gains `topics` (JSON) and `url_key`; `threads.entry_id` becomes nullable with a new nullable `cluster_id` (exactly one set) so a thread can be drafted from a whole cluster.
- `settings` — key/value: interval, Telegram bot token + chat ID, Floxy host/port/user/pass, Twitter tokens, taste prompt, generation prompt, voice-example count. **Secrets live in this local file** — acceptable for a single-user localhost tool; the file stays out of any git repo.
- Runs older than 30 days pruned on startup.

## Permissions / dependencies

- **Local prerequisites**: Bun, `claude` CLI (logged in), twitter-cli binary.
- **Accounts**: Floxy (residential proxy), a Telegram bot (token via BotFather), X session cookies.
- **No official YouTube/Twitter API keys, no cloud services, no exposed ports** — dashboard on `127.0.0.1` only.
- Outbound network: YouTube (via proxy), X (via twitter-cli), HN Firebase API, RSS hosts, Telegram API.

## Communication map

```
scheduler ──▶ fetchers ──▶ entries (dedupe) ──▶ filter (claude -p) ──▶ notifier (Telegram)
                │                                      │
                └── run_sources ◀── attempts/errors    └── matched entry
React SPA ◀──▶ /api/* :
  GET  entries?state=…        inbox
  POST entries/:id/draft      generator (claude -p + voice examples)
  PUT  threads/:id            save edits
  POST threads/:id/posted     store final_text (joins voice pool)
  CRUD sources                sources page
  GET  runs, runs/:id         runs page
  POST runs/trigger           "Run now"
  GET/PUT settings            settings page
  POST test/telegram|proxy|twitter   the three test buttons
```

Every mockup element maps: inbox cards ← `entries` + filter reason; lifecycle chips ← `entries.state`; editor transcript panel ← `entries.transcript`; tweet blocks ← `threads.draft_json`; voice note ← settings count + `threads.final_text` pool; sources health ← latest `run_sources`; runs page ← `runs` + `run_sources` incl. attempts + error_text; settings sections ← `settings` keys; test buttons ← `/api/test/*`.

## Fragility & containment

| Fragile thing | Failure mode | Containment |
|---|---|---|
| YouTube bot protection | transcript fetches blocked, 4xx | Fresh Floxy IP per attempt; detection stays on RSS (rarely blocked); failures land in `run_sources.error_text`, entries retried next run; all YT logic in one module |
| twitter-cli / cookie expiry | subprocess errors, empty output | "Test auth" button in settings; failures visible per-run; other sources unaffected |
| Floxy credentials/outage | 407s (the Runs mockup case) | Retry with fresh sessions, then fail visibly with a plain-language hint linking to settings |
| `claude -p` output variance | unparseable filter/generator output | Prompt demands strict format; defensive parse + one retry; filter failures leave entries `pending`, never lost |
| RSS feed quirks | malformed XML | Tolerant parser; per-source isolation |
| Schedule drift (process down) | missed runs | Scheduler is in-process — if the tool is up, runs happen; "last checked" timestamps make gaps visible on Sources |
