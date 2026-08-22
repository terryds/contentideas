#!/usr/bin/env bun
// Content Engine doctor — verifies every dependency and credential the app
// needs, with a fix hint per finding. Run it first on any fresh machine:
//   cd build && bun run doctor
//
// ✓ = healthy · ! = optional/missing (app runs, that feature degrades) · ✕ = blocker
// Exit code 1 when any ✕ is present. Makes one tiny `claude -p` call to prove login.

import { existsSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
let warnings = 0;
const ok = (msg: string) => console.log(`  ✓ ${msg}`);
const warn = (msg: string, fix?: string) => {
  warnings++;
  console.log(`  ! ${msg}${fix ? `\n      fix: ${fix}` : ""}`);
};
const fail = (msg: string, fix?: string) => {
  failures++;
  console.log(`  ✕ ${msg}${fix ? `\n      fix: ${fix}` : ""}`);
};
const section = (title: string) => console.log(`\n${title}`);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

console.log("Content Engine doctor");

/* ---------- runtime ---------- */
section("Runtime");
ok(`bun ${Bun.version}`);
if (existsSync(join(import.meta.dir, "node_modules"))) ok("dependencies installed");
else fail("dependencies not installed", "bun install");

/* ---------- database (also loads settings for the checks below) ---------- */
section("Database");
let settingsAvailable = false;
let getSetting: (key: string) => string | null = () => null;
try {
  const dbModule = await import("./server/db/db");
  const { migrate } = await import("./server/db/migrate");
  migrate();
  getSetting = dbModule.getSetting;
  settingsAvailable = true;
  const version = (dbModule.db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  ok(`SQLite ready, migrations applied (schema v${version})`);
} catch (err) {
  fail(`database failed: ${message(err)}`);
}

const configured = (...keys: string[]) => settingsAvailable && keys.every((key) => !!getSetting(key));

/* ---------- claude CLI ---------- */
section("claude CLI (taste filter + thread generation)");
if (!Bun.which(process.env.CONTENT_ENGINE_CLAUDE_BIN ?? "claude")) {
  fail("`claude` not found on PATH", "install Claude Code and log in: https://claude.com/claude-code");
} else {
  ok("`claude` binary found");
  try {
    // Exercises the exact path the app uses: structured output via --json-schema.
    const { runClaudeStructured } = await import("./server/llm/claude");
    await runClaudeStructured("Set ok to true.", {
      type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"],
    }, { timeoutMs: 90_000 });
    ok("`claude -p` structured output works — logged in, --json-schema supported");
  } catch (err) {
    fail(`\`claude -p\` failed: ${message(err)}`, "log in via `claude`, and update the CLI if --json-schema is unsupported");
  }
}

/* ---------- telegram ---------- */
section("Telegram (match + trending notifications)");
if (!configured("telegram_bot_token", "telegram_chat_id")) {
  warn("bot token / chat ID not configured — no notifications will be sent", "Settings → Telegram, then “Send test message”");
} else {
  try {
    const res = await fetch(`https://api.telegram.org/bot${getSetting("telegram_bot_token")}/getMe`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: { username?: string } } | null;
    if (body?.ok) ok(`bot token valid (@${body.result?.username ?? "unknown"}); chat ID set`);
    else fail(`Telegram rejected the bot token (HTTP ${res.status})`, "re-copy the token from @BotFather in Settings → Telegram");
  } catch (err) {
    fail(`Telegram API unreachable: ${message(err)}`);
  }
}

/* ---------- floxy ---------- */
section("Floxy proxy (YouTube transcripts)");
if (!configured("floxy_host", "floxy_port", "floxy_username", "floxy_password")) {
  warn("proxy not configured — YouTube transcript fetches will fail", "Settings → Floxy proxy, then “Test connection”");
} else {
  try {
    const { testProxy } = await import("./server/proxy/floxy");
    ok(await testProxy());
  } catch (err) {
    fail(`proxy check failed: ${message(err)}`, "verify credentials in Settings → Floxy proxy");
  }
}

/* ---------- twitter ---------- */
section("twitter CLI (X profile sources)");
if (!Bun.which("twitter")) {
  warn("`twitter` binary not on PATH — X sources will fail to fetch", "install twitter-cli (github.com/public-clis/twitter-cli)");
} else {
  ok("`twitter` binary found");
  const inSettings = configured("twitter_auth_token", "twitter_ct0");
  const inEnv = !!process.env.TWITTER_AUTH_TOKEN && !!process.env.TWITTER_CT0;
  if (inSettings) {
    try {
      const { testAuth } = await import("./server/fetchers/twitter");
      ok(`cookies in Settings — authenticated as ${await testAuth()}`);
    } catch (err) {
      fail(`X auth failed: ${message(err)}`, "re-copy auth_token + ct0 from your browser into Settings → Twitter CLI");
    }
  } else if (inEnv) {
    warn("cookies found in env (.env.local — used by tests) but NOT in Settings — the running app reads Settings only", "paste the same cookies into Settings → Twitter CLI");
  } else {
    warn("X cookies not set — X sources will fail to fetch", "Settings → Twitter CLI (auth_token + ct0 from your browser)");
  }
}

/* ---------- summary ---------- */
section("Summary");
if (failures > 0) console.log(`  ${failures} blocker(s), ${warnings} warning(s) — fix the ✕ items above.`);
else if (warnings > 0) console.log(`  Healthy with ${warnings} warning(s) — optional features degraded, see ! items.`);
else console.log("  All checks passed. Fire it up: bun run dev (or bun run build && bun run start).");
process.exit(failures > 0 ? 1 : 0);
