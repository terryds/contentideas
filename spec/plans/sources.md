# Sources — management & health

## What & why

Where the owner curates what the engine watches. Four source types behind one table, with per-source health surfaced from run history — so a dying source is visible here, not discovered by silence.

## Behavior

- **Add** ([mockup](../../planning/4-mockups/sources.html)): type select (YouTube channel / X profile / Hacker News front page / RSS feed) + URL-or-handle input, plus **check interval** (15m…24h, default 30m) and **max records per check** (1–100, default 30) *(v1.2 — per-source cadence)*. Both editable inline in the table afterwards (select/number → save on change). On add:
  - YouTube: accept `youtube.com/@handle` or bare `@handle`; resolve to channel_id immediately (needed for the RSS detection feed) and store both; resolution failure → inline field error, source not created.
  - X: accept `@handle` or profile URL; store handle.
  - HN: no input needed — adding creates the singleton front-page source (hide input when selected; only one HN source allowed).
  - RSS: accept feed URL; validate by fetching once; store the feed's own title as display name (editable later — open question).
- **Table:** type badge (mono `YT|X|HN|RSS`), display name + URL, last checked (from latest `run_sources`), new & matched counts (7-day window), **Health** = latest `run_sources` status: `OK` green / `Retrying` amber / `Failed ×n` crimson **with the error hint and a "see run" link** to the expanded failing run. Paused rows dimmed with Resume.
- **Run now (per source)** *(added 2026-08-20)*: each row has a Run button firing a manual run scoped to just that source (`POST /api/sources/:id/run` → `runOnce("manual", sourceId)`); the UI jumps to the run's row on the Runs page to watch it live. Full pipeline still applies (filter, match digest, tag auto-drafts). Refused while another run is in progress; paused sources can't be run.
- **Pause/Resume:** toggles `active`; paused sources are skipped by runs, keep their history and entries.
- **Remove:** confirm dialog; deletes the source; its entries/threads remain (source label preserved on entries via stored display name — denormalize at ingestion time).
- **Empty state:** no sources → the add form plus a short hint ("Add your first source — the next run will pick it up").

## Architecture mapping

`server/routes/sources.ts`, `web/src/pages/Sources.tsx`; health joins `run_sources`; first-fetch "initial import" behavior specified in [ingestion.md](ingestion.md).

## Edge cases & open questions

- Duplicate adds (same handle/URL) → reject with a friendly inline error.
- Handle→channel_id resolution may itself hit YouTube bot protection → do it through the proxy if a plain fetch fails; both attempts' errors shown if it still fails.
- Open: editable display names — nice-to-have, only if trivial.
