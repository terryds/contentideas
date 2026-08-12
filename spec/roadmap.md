# Roadmap

Build in order; verify each milestone's "done when" before advancing. Ordered by dependency, then risk — external-dependency work (YouTube, Twitter) comes as early as its prerequisites allow. Every v1 feature in [README.md](README.md) appears in exactly one milestone (mapping noted per milestone).

## M0 — Walking skeleton *(features: 1)*

Scaffold `build/` exactly per [structure.md](structure.md); thinnest end-to-end slice: Hono server + SQLite migrations + React SPA shell (nav + five empty routes, design tokens applied) + source CRUD + RSS fetcher + manual ingestion.
Draws from: [plans/core.md](plans/core.md), [plans/sources.md](plans/sources.md), the RSS part of [plans/ingestion.md](plans/ingestion.md).
**Done when:** `bun run dev` starts everything; adding an RSS feed on /sources then POSTing `/api/runs/trigger` stores entries visible in the Inbox (unfiltered for now, state `new`); restarting loses nothing.

## M1 — Scheduler, run history, HN *(features: 2, 12)*

`Bun.cron` scheduling from the interval setting, `runOnce()` shared with "Run now", per-source isolation + 3-attempt retries with backoff, `runs`/`run_sources` recording (attempt traces, error_text), Runs page per its mockup, HN front-page fetcher as the second source type, 30-day pruning.
Draws from: [plans/ingestion.md](plans/ingestion.md).
**Done when:** with the interval set to a test value, two consecutive runs fire unattended and render correctly on /runs; a deliberately broken RSS URL shows Failed with its error and attempts while other sources still succeed in the same run.

## M2 — Settings & credentials *(feature: 11)*

Settings page per its mockup: schedule interval, Telegram bot token + chat ID, Floxy host/port/user/pass, Twitter tokens, taste prompt, generation prompt, voice-example count. Secrets stored in SQLite, write-only over the API (GET returns presence, never values). Three test endpoints wired to real checks.
Draws from: [plans/settings.md](plans/settings.md).
**Done when:** all settings persist across restart; "Send test message" delivers a real Telegram message; proxy and Twitter test buttons return real pass/fail with actionable error text.

## M3 — Taste filter & Telegram *(features: 6, 7)*

`llm/claude.ts` subprocess wrapper (timeout, defensive parse, one retry), filter pass integrated into the run pipeline (`pending` → `matched`/`skipped` + one-line reason), Telegram notification per match, Inbox per its mockup: filter chips, filter's-take on cards, Dismiss, empty state.
Draws from: [plans/filter-notify.md](plans/filter-notify.md).
**Done when:** a run against live sources produces MATCH/SKIP verdicts with reasons stored; each match arrives as a Telegram message with title/source/reason/link; a filter-call failure leaves entries `pending` and they are re-filtered on the next run.

## M4 — Thread studio *(features: 8, 9, 10)*

"Draft thread" → `llm/generator.ts` (generation prompt + item content + last N posted finals), Editor page per its mockup: auto-sizing tweet blocks, char counts with over-280 state, add tweet, Regenerate, Copy all, "Mark as posted" storing final text into the voice pool.
Draws from: [plans/threads.md](plans/threads.md).
**Done when:** a matched HN/RSS item generates an editable draft; edits persist; Copy all puts the full thread on the clipboard; after marking posted, the next generation's `claude -p` input demonstrably contains that final text as a voice example.

## M5 — YouTube via Floxy *(features: 3, 4)*

Riskiest integration, isolated: YouTube channel source type with detection via channel RSS feed; `transcript.ts` trial-and-error over candidate libraries (`youtubei.js`, `youtube-transcript`, `yt-dlp` subprocess), every transcript request through `proxy/floxy.ts` with a fresh session per attempt; transcript shown in the Editor's source panel and included in generation input.
Draws from: [plans/ingestion.md](plans/ingestion.md) (YouTube section), [plans/threads.md](plans/threads.md) (transcript in editor).
**Done when:** a real channel's new video is detected, matched (or force-matched for testing), its transcript fetched through the proxy and visible in the Editor, and a drafted thread references transcript content; proxy failures surface in run history with the attempt trace.

## M6 — Twitter & polish *(feature: 5)*

X-profile source type via twitter-cli subprocess (tokens from settings), Sources health column linking to the failing run, remaining empty/error states across pages, favicon (crimson "C" monogram), final pass against the styleguide in light and dark.
Draws from: [plans/ingestion.md](plans/ingestion.md) (Twitter section), [plans/sources.md](plans/sources.md).
**Done when:** a real X profile's new tweets flow through filter → Telegram → thread draft end-to-end; expired-cookie failure mode shows a clear error in run history and "Test auth" in settings reproduces it; all five pages match their mockups in both themes.
