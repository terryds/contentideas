# Core — process, database, SPA shell

## What & why

The foundation every feature stands on: one Bun process (Hono API + static SPA + `Bun.cron`), the SQLite schema, and the React shell with the design system. Exists so every later plan only adds routes, fetchers, and pages — never plumbing.

## Behavior

- `bun run dev`: starts the server on `127.0.0.1` (fixed port, e.g. 4321) and Vite dev server proxying `/api`. `bun run start` serves `web/dist` from the same process.
- Boot order: run migrations → prune runs older than 30 days → load settings → register `Bun.cron` job → listen.
- API errors: `{error: string}` + proper status. SPA shows them inline, plain-language.
- **Working state:** nav (Inbox / Sources / Runs / Settings) per the mockups' shared header; active route accent-underlined.
- **Empty state (fresh install):** every page renders sensibly with zero rows; Inbox shows "All caught up" variant with zero counts; no crashes on empty settings — features needing missing credentials fail with a pointer to Settings.
- **Error state:** API unreachable → SPA banner "Server not responding — is the process running?".
- **Loading state** *(added 2026-08-20)*: pages never render zeros/empty-state cards before their first fetch resolves — a quiet "Loading…" holds the space until real data arrives.

## Data (full schema — owned here, used everywhere)

- `sources`: id, type (`youtube|twitter|hn|rss`), handle_or_url, display_name, active (bool), created_at.
- `entries`: id, source_id, external_id, title, url, content, transcript (nullable), filter_status (`pending|matched|skipped`), filter_reason, filtered_at, state (`new|notified|drafted|posted|dismissed`), created_at. **Unique (source_id, external_id).**
- `threads`: id, entry_id, draft_json (JSON array of strings), final_text (nullable), posted_at (nullable), updated_at.
- `runs`: id, trigger (`cron|manual`), started_at, finished_at, totals (new/matched/failed counts).
- `run_sources`: id, run_id, source_id, new_count, matched_count, duration_ms, attempts, status (`ok|retrying|failed`), error_text.
- `settings`: key (PK), value. Secrets included — local file, gitignored.

## Looks like

Shared nav + tokens from [../../planning/3-design/styleguide.html](../../planning/3-design/styleguide.html) ([brand.md](../../planning/3-design/brand.md)): warm paper, crimson accent (also failure), green happy-path, serif headings, 8px grid, three-state light/dark tokens.

## Architecture mapping

`server/index.ts`, `server/db/*`, `web/src/{main.tsx, api.ts, styles/tokens.css, components/*}` per [structure.md](../structure.md).

## Edge cases & open questions

- Concurrent runs: `runOnce()` must no-op (with a log) if a run is already in progress — cron firing during a slow manual run must not double-fetch.
- Migrations must be idempotent; schema changes after M0 ship as additive migration steps in `migrate.ts`.
- Open: exact port — pick one unlikely to collide and keep it in one constant.
