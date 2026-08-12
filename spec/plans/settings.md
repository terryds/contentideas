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

## Secrets handling

- Secrets stored in SQLite (local, gitignored — accepted for a single-user localhost tool).
- **API never returns secret values**: GET /api/settings returns `{set: true}` per secret; the UI shows masked placeholders (mockup's dots) and only sends a secret when the field is actually edited. Server logs must never print secrets or pass them via argv (twitter-cli gets them as env vars).

## Architecture mapping

`server/routes/settings.ts`, `server/routes/test.ts`, `web/src/pages/Settings.tsx`; consumed by `scheduler.ts`, `notify/telegram.ts`, `proxy/floxy.ts`, `fetchers/twitter.ts`, `llm/*`.

## Edge cases & open questions

- Missing credentials at run time: the dependent source/notification fails with "not configured — add it in Settings" in run history; everything else proceeds.
- Chat ID and port validated as numeric on save.
- Open: Floxy session-rotation format (how username encodes a fresh session id) — pin the exact scheme from the user's Floxy account docs during M2; keep it inside `proxy/floxy.ts`.
