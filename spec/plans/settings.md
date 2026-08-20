# Settings — credentials, prompts, tests

## What & why

The engine's control panel: every credential, both prompts, and the schedule, each credential block with a test button — so misconfiguration is caught here in seconds, never diagnosed through a failed 3 a.m. cron run.

## Behavior

Sections per the [mockup](../../planning/4-mockups/settings.html), all persisted to the `settings` table on **Save changes** (sticky save bar appears when dirty, names the dirty section):

- **Schedule:** interval select (15 min / 30 min / 1 h / 3 h). Saving re-registers the `Bun.cron` job immediately.
- **Telegram:** bot token (secret), chat ID. **Send test message** → real `sendMessage` ("Content Engine test — it works"); inline result: green "✓ Delivered HH:MM" or crimson "✕ <api error>".
- **Floxy proxy:** host, port, username, password (secret). **Test connection** → fetch a known URL through a fresh proxy session; inline pass/fail with actionable text ("✕ 407 auth failed — check username/password").
- **Twitter CLI:** `TWITTER_AUTH_TOKEN`, `TWITTER_CT0` (both secret). **Test auth** → twitter-cli whoami-equivalent; success shows "✓ Logged in as @handle".
- **Taste filter prompt:** multiline textarea; this text is the filter's core instruction (system additionally enforces the MATCH/SKIP output contract — the enforced envelope lives in code, the taste lives here).
- **Thread generation prompt:** multiline textarea, same split: voice/format wishes here, JSON output contract in code. Plus **voice examples count** select (last 3 / 5 / 10 posted threads).
- Defaults on fresh install: 30-min interval, both prompts pre-filled with sensible starter text (adapted from the mockups), everything else empty.

- **Danger zone — Clear history data** *(v1.2)*: one confirm-guarded action that deletes all ingested entries, runs/run history, clusters, and **unposted** drafts — keeping sources, settings, and **posted threads** (they are the voice-example pool; clearing history shouldn't lobotomize the writing voice). After clearing, each source's next fetch counts as a first fetch again → the initial-import rule applies, so current feed contents are recorded as seen without a Telegram blast; only genuinely new posts from then on get filtered and notified. Refused with a clear error while a check is running.

## Secrets handling

- Secrets stored in SQLite (local, gitignored — accepted for a single-user localhost tool).
- **API never returns secret values**: GET /api/settings returns `{set: true}` per secret; the UI shows masked placeholders (mockup's dots) and only sends a secret when the field is actually edited. Server logs must never print secrets or pass them via argv (twitter-cli gets them as env vars).

## Architecture mapping

`server/routes/settings.ts`, `server/routes/test.ts`, `web/src/pages/Settings.tsx`; consumed by `scheduler.ts`, `notify/telegram.ts`, `proxy/floxy.ts`, `fetchers/twitter.ts`, `llm/*`.

## Edge cases & open questions

- Missing credentials at run time: the dependent source/notification fails with "not configured — add it in Settings" in run history; everything else proceeds.
- Chat ID and port validated as numeric on save.
- ~~Open: Floxy session-rotation format~~ **Pinned from a real Floxy example (2026-08-20):** credentials are `host:port:username:password`, and rotation is encoded in the **password** as underscore-delimited suffixes — `<password>_session-<alnum-id>_lifetime-<seconds>` (e.g. `…_session-6pssgtl6_lifetime-1200`). Username stays bare. Session ids must be alphanumeric (an underscore would break Floxy's password parsing). Kept inside `proxy/floxy.ts`.
