# Content Engine — agent guide

Single-user local tool for a Twitter/X content creator: watches sources (YouTube channels, X profiles, HN front page, RSS) on a cron, taste-filters every new entry via the `claude -p` CLI, pings Telegram on matches and cross-source trending stories, and turns items into thread drafts the owner edits and posts. Stack: Bun + Hono + SQLite, React/Vite SPA, one process, `127.0.0.1` only.

## First thing on a fresh machine: run the doctor

```bash
cd build
bun install
bun run doctor
```

The doctor verifies everything this app leans on and prints a fix hint per finding: bun + deps, SQLite migrations, **claude CLI installed AND logged in** (`claude -p` errors when logged out — it makes one tiny call to prove login), Telegram bot token validity, Floxy proxy connectivity (fresh-session rotation), and the `twitter` binary + X cookie auth. `✕` items block core functionality (exit code 1); `!` items degrade one feature. Fix what it flags before doing anything else — every external integration here was at some point broken by a wrong assumption, and the doctor exists so nobody rediscovers that in production.

## Repo layout

| Path | What it is |
|---|---|
| `planning/` | Planning "src" — brainstorm, scope, design system, throwaway mockups, architecture, decision log |
| `spec/` | **The contract.** README (features), `plans/<area>.md`, `structure.md` (code layout), `roadmap.md` (M0→M8) |
| `build/` | The real app, laid out per `spec/structure.md`. `BUILD-LOG.md` = per-milestone record of what/how/verified |

## Commands (all from `build/`)

- `bun run dev` — Bun API server (`:4321`, auto-restart) + Vite dev server (`:5173`, HMR, proxies `/api`)
- `bun run build && bun run start` — production: one Bun process serves API + built SPA
- `bun run test` — fast suite (unit + integration; temp DB, localhost fixture feed, stubbed claude). Keep it green.
- `bun run test:live` — opt-in checks of the real external boundaries, driven by `test/live-sources.json`
- `bun run doctor` — dependency & credential checkup (see above)

## Rules

1. **Spec first.** If reality forces a change, update the relevant `spec/` file, *then* the code. Log notable choices as one-liners in `planning/decisions.md`.
2. **Everything lives in `build/`** — never scatter code, logs, or reports next to `planning/` and `spec/`.
3. **Append to `build/BUILD-LOG.md`** after any milestone-sized change: what was built, how it was verified, deviations from spec.
4. **Secrets:** the app reads credentials from its settings table (SQLite at `build/data/`, gitignored); tests read X cookies from `build/.env.local` (gitignored, loaded by `test/setup.ts`). Never commit either; never print secret values or pass them via argv.
5. **Seams to respect:** all `claude -p` calls go through `server/llm/claude.ts`; all Floxy usage through `server/proxy/floxy.ts`; only `server/fetchers/transcript.ts` knows the transcript flow; new source types = one new fetcher file + a Sources UI option.
6. **Mockups (`planning/4-mockups/`) are throwaway** — reference only, never upgraded into real code. The visual contract is `planning/3-design/` (tokens live in `web/src/styles/tokens.css`).
7. `bun run test` and `bunx tsc --noEmit` must pass before you call anything done.
