Status: done

# Scope

Decision: everything from the brainstorm's core idea ships in v1 — this is an internal single-user tool, so the cut line is "core pipeline in, someday-list out."

## v1 — building now

1. **Source management** — add/pause/remove sources of four types in the dashboard: YouTube channel, X (Twitter) profile, Hacker News front page, RSS feed.
2. **Cron ingestion** — poll all active sources on a schedule, detect new entries since last run, with retries on failure.
3. **YouTube fetching via Floxy** — every YouTube request goes through a Floxy residential proxy with a fresh session (new IP) per fetch.
4. **YouTube transcripts** — fetch the transcript for matched videos (through the proxy; exact library chosen by trial and error during build).
5. **Twitter fetching via twitter-cli** — pull profile tweets using `TWITTER_AUTH_TOKEN` + `TWITTER_CT0`.
6. **Taste filter** — every new entry is judged by one global, customizable prompt executed with `claude -p`.
7. **Telegram notifications** — matched entries ping me on Telegram at a chat ID set in the dashboard.
8. **One-click thread draft** — from any matched item, generate a Twitter thread via `claude -p` using a customizable generation prompt.
9. **Draft editor** — review and edit the generated thread in the dashboard; I copy-paste to X myself.
10. **Posted-finals feedback loop** — marking a thread "posted" stores my final edit, and the last N posted finals are auto-injected into the generation prompt as few-shot voice examples.
11. **Settings page** — Floxy credentials, Twitter tokens, Telegram chat ID, taste-filter prompt, thread-generation prompt.
12. **Cron-run history** — a debugging view listing each run with per-source outcomes, timings, and errors.

## Later — parked

- "Post it" button that publishes directly via twitter-cli (review + copy-paste is enough for now).
- "Refine my voice": distill draft→final edit deltas into an editable voice guide.
- Daily digest mode instead of per-item pings.
- Tracking which ideas became tweets and how they performed.
- Other output formats (single tweets, long-form); multiple taste profiles; per-source filter prompts.
- Thumbs up/down on Telegram matches to refine the taste filter.
- Reddit and other source types.

## No — rejected (and why)

- **Multi-user / auth / hosting for others** — this is an internal tool for one person on their own machine.
- **Official YouTube/Twitter APIs** — cost and quota friction; scraping + twitter-cli fits a personal-scale tool.
