Status: done

# Brainstorm

Raw ideas. No filtering, no judging. Quantity over quality.

## Context

I'm a social media content creator, mainly on X (Twitter). This is an **internal tool for myself** — a content-source watcher that feeds me interesting material.

## Core idea

- Ingest many sources on a schedule (cron / polling for updates or new information):
  - YouTube channels
  - Twitter/X account profiles
  - Websites like Hacker News
- Filter each new entry against **my taste**, expressed as a prompt — run the filter with `claude -p`.
- When an entry matches, **notify me via Telegram** (chat ID configurable in dashboard settings).

## Technical notes / constraints (from the start)

- **Tech stack: Bun. Database: SQLite.**
- YouTube has aggressive bot protection → use **residential IPs via Floxy**, generating a new session (new IP) each time.
- Twitter via **twitter-cli** (https://github.com/public-clis/twitter-cli), authenticated with `TWITTER_AUTH_TOKEN` + `TWITTER_CT0`.
- Implement **retries** on fetching.
- **Dashboard with settings** for credentials: Floxy, Twitter CLI tokens, Telegram chat ID.
- Cron must be **debuggable**: a cron-runs history view so I can see when something goes wrong.

## Ideas

- **Content pipeline, not just alerts**: matched items feed my creation flow. From a matched item, I can **create a Twitter thread with one click** — the button calls `claude -p` (via CLI) to draft it.
- The **thread-generation prompt is customizable in settings** (just like the taste-filter prompt).
- **YouTube transcripts**: for matched videos, fetch the transcript too (so thread generation has real material to work from). Library choice = trial and error; transcript fetching will likely also need the Floxy proxy.
- **Taste filter: one global prompt for now** (not per-source).
- **Review-first thread flow**: I review/edit the generated draft in the dashboard and copy-paste it to X myself. No "post it" button for now.
- **Hacker News = front page** (that's what gets watched, then taste-filtered).
- **RSS feeds as a fourth source type.** No Reddit or anything else right now.
- **Feedback loop (in v1)**: after editing a draft in the dashboard, I manually mark it as *posted* — the final edited text is already in the DB at that point. The last N posted finals get **auto-injected as few-shot examples** into the thread-generation prompt ("here are threads I actually posted; match this voice"). No learning machinery — improves with every post.

## Wild / someday (parked from brainstorm)

- "Refine my voice" button: distill draft→final edit deltas into an editable voice guide in settings.
- Daily digest mode instead of per-item Telegram pings.
- Track which ideas became tweets and how they performed.
- Other output formats (single tweets, long-form); multiple taste profiles; per-source filter prompts.
- Thumbs up/down on Telegram matches to refine the taste filter.

## Annoyances

## Wild / someday

