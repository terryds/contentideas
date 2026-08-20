# Testing — automated test suite *(v1.2, M8)*

## What & why

v1 shipped with zero automated tests (verification was live-poking, recorded in BUILD-LOG). This plan adds a `bun test` suite so regressions surface before the cron does, plus an opt-in live suite that answers "can it actually ingest *my* sources?" against the owner's real feeds/channels/profiles.

## Layers

1. **Unit** (`test/unit/`) — pure functions against fixture files, no network/DB/subprocess: `normalizeUrlKey`, filter verdict+topics parsing, thread JSON parsing, transcript truncation, RSS/Atom `parseFeed`, twitter-cli output parsing, timedtext `parseTimedText`, `sourceLabel`.
2. **Integration** (`test/integration/`) — real SQLite in a throwaway temp dir, no external network: migration idempotency + the v1→M7 upgrade path, the **full `runOnce()` pipeline** against a localhost `Bun.serve` fixture feed (ingest → dedupe → initial-import rule → filter → notify attempt → clustering), the M7 clustering matrix (kept from the verify scripts), API routes via `createApp().request()` (no port), draft→edit→posted→voice-pool loop.
3. **Live** (`test/live/`, opt-in via `bun run test:live`) — the owner's real sources from `test/live-sources.json` (owner-edited; a placeholder ships): each RSS feed / YouTube channel / X profile / HN must fetch ≥1 sane entry; plus one real `claude -p` filter round-trip. Live tests are allowed to be slow and need credentials (X cookies via env); they never gate the fast suite.

## Test seams (small refactors, useful beyond tests)

- `db.ts`: data dir overridable via `CONTENT_ENGINE_DATA_DIR` env var — tests get a temp DB, never `data/content-engine.db`.
- `index.ts` splits into `app.ts` (`createApp()` — routes only, no side effects) + a thin boot; tests import the app without starting cron or binding a port.
- `migrate.ts`: migration runner takes a `Database` handle (`migrateDb(db)`) so the upgrade test can build a v1-state DB and migrate it in isolation.
- `llm/claude.ts`: binary overridable via `CONTENT_ENGINE_CLAUDE_BIN` — integration tests point it at a generated stub that answers the filter contract or the generator contract (sniffed from the prompt on stdin) deterministically. Unset = real `claude`, unchanged behavior.
- `fetchers/twitter.ts`: tweet-JSON parsing extracted as pure `parseTweets()`.

## Conventions

- Runner: `bun test`; preload `test/setup.ts` (via `bunfig.toml`) sets the temp data dir before any module imports the DB singleton.
- Integration tests share one DB process-wide (Bun runs test files in one process); a `resetDb()` helper wipes rows between tests. Settings defaults reseeded by `migrate()`.
- `bun run test` = unit + integration (fast, deterministic, no creds). `bun run test:live` = live suite with a long timeout.
- Fixtures in `test/fixtures/`: RSS 2.0 + Atom documents, twitter-cli JSON, timedtext json3, canned claude outputs.

## Edge cases & open questions

- Live X test needs cookies: read from `TWITTER_AUTH_TOKEN`/`TWITTER_CT0` env (never committed), seeded into the temp DB for the test.
- Live YouTube transcript-through-proxy is NOT in the suite — it needs Floxy credentials and burns proxy traffic; the owner verifies that path manually via the Settings test button + a real run.
- Open: CI is out of scope (single-user local tool) — the suite is a pre-deploy habit, not a gate.
