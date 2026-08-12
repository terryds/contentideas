# Content Engine — build spec

**Content Engine** (*Fuel for your feed*) is a single-user, local-first tool for a Twitter/X content creator. It watches content sources (YouTube channels, X profiles, the Hacker News front page, RSS feeds) on a schedule, filters every new entry through a personal taste prompt via the `claude -p` CLI, pings the owner on Telegram when something matches, and turns matched items into Twitter-thread drafts — which the owner edits in the dashboard, copy-pastes to X, and marks as posted, feeding their final versions back into future drafts as voice examples. Stack: **Bun** (one process: Hono API + native `Bun.cron` scheduler), **SQLite**, **React SPA** (Vite). Binds to `127.0.0.1` only.

## v1 features

1. **Source management** — add/pause/remove YouTube channels, X profiles, HN front page, RSS feeds.
2. **Cron ingestion** — poll all active sources on a schedule via `Bun.cron`, detect new entries, retry on failure.
3. **YouTube via Floxy** — YouTube requests go through a Floxy residential proxy, fresh session (new IP) per attempt.
4. **YouTube transcripts** — fetched for matched videos through the proxy (library chosen by trial and error).
5. **Twitter fetching via twitter-cli** — profile tweets using `TWITTER_AUTH_TOKEN` + `TWITTER_CT0`.
6. **Taste filter** — every new entry judged by one global customizable prompt run with `claude -p`.
7. **Telegram notifications** — matched entries ping the owner at a configurable chat ID.
8. **One-click thread draft** — generate a thread from any matched item via `claude -p` with a customizable prompt.
9. **Draft editor** — review/edit tweet blocks in the dashboard; owner copy-pastes to X manually.
10. **Posted-finals feedback loop** — "mark as posted" stores the final text; last N posted finals are injected into generation as few-shot voice examples.
11. **Settings page** — Floxy, Twitter, Telegram credentials, both prompts, schedule; each credential block has a test button.
12. **Cron-run history** — every run with per-source outcomes, attempt traces, and errors.

## Not doing

**Later (parked):** "Post it" button publishing via twitter-cli · voice-guide distillation from edit deltas · daily digest mode · idea→tweet performance tracking · other output formats · multiple taste profiles · per-source filter prompts · thumbs up/down filter feedback · Reddit or other source types.

**No (rejected):** multi-user, auth, or hosting for others (single-user local tool) · official YouTube/Twitter APIs (cost/quota; scraping + twitter-cli fit personal scale).

## Index

- [structure.md](structure.md) — planned codebase layout in `build/`
- [roadmap.md](roadmap.md) — build order M0 → M6, each with a verifiable "done when"
- [plans/core.md](plans/core.md) — server process, DB schema, SPA shell, design tokens
- [plans/ingestion.md](plans/ingestion.md) — scheduler, fetchers (RSS/HN/YouTube/Twitter), retries, run history
- [plans/filter-notify.md](plans/filter-notify.md) — taste filter via `claude -p`, Telegram notifier, inbox lifecycle
- [plans/threads.md](plans/threads.md) — thread generation, draft editor, posted-finals voice pool
- [plans/sources.md](plans/sources.md) — source CRUD and health reporting
- [plans/settings.md](plans/settings.md) — settings storage, secrets, test endpoints

Reference material (not part of the spec, but linked from plans): visual system in `../planning/3-design/` (brand.md + styleguide.html), throwaway mockups in `../planning/4-mockups/`, full architecture rationale in `../planning/5-architecture/architecture.md`, decision log in `../planning/decisions.md`.
