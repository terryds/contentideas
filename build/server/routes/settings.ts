import { Hono } from "hono";
import { db, getSetting, setSetting } from "../db/db";

const settings = new Hono();

// Secrets are write-only over the API: GET reports presence, never values.
export const SECRET_KEYS = [
  "telegram_bot_token",
  "floxy_password",
  "twitter_auth_token",
  "twitter_ct0",
] as const;

export const PLAIN_KEYS = [
  "telegram_chat_id",
  "floxy_host",
  "floxy_port",
  "floxy_username",
  "tags",
  "taste_prompt",
  "generation_prompt",
  "voice_examples_count",
  "trending_threshold",
  "timezone",
] as const;

settings.get("/", (c) => {
  const values: Record<string, string | null> = {};
  for (const key of PLAIN_KEYS) values[key] = getSetting(key);
  const secrets: Record<string, { set: boolean }> = {};
  for (const key of SECRET_KEYS) secrets[key] = { set: !!getSetting(key) };
  return c.json({ values, secrets });
});

settings.put("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return c.json({ error: "Send a JSON object of settings" }, 400);

  const allowed = new Set<string>([...PLAIN_KEYS, ...SECRET_KEYS]);
  const updates: [string, string][] = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!allowed.has(key)) return c.json({ error: `Unknown setting "${key}"` }, 400);
    const value = String(raw ?? "");
    if (key === "telegram_chat_id" && value && !/^-?\d+$/.test(value))
      return c.json({ error: "Chat ID must be numeric" }, 400);
    if (key === "floxy_port" && value && !/^\d+$/.test(value))
      return c.json({ error: "Port must be numeric" }, 400);
    if (key === "voice_examples_count" && !["3", "5", "10"].includes(value))
      return c.json({ error: "Voice examples count must be 3, 5, or 10" }, 400);
    if (key === "trending_threshold" && !/^[2-9]$/.test(value))
      return c.json({ error: "Trending threshold must be a number from 2 to 9" }, 400);
    if (key === "timezone") {
      const { validTimezone } = await import("../clock");
      if (!value || !validTimezone(value))
        return c.json({ error: `Unknown timezone "${value}" — use an IANA name like Asia/Jakarta` }, 400);
    }
    updates.push([key, value]);
  }

  db.transaction(() => {
    for (const [key, value] of updates) setSetting(key, value);
  })();

  return c.json({ ok: true });
});

// Danger zone: wipe ingestion history — entries, runs, clusters, unposted
// drafts. Keeps sources, settings, and POSTED threads (the voice-example pool).
// Sources re-import as seen on the next check (initial-import rule), so nothing
// gets re-notified.
settings.post("/clear-history", async (c) => {
  const { runningRunId } = await import("../scheduler");
  if (runningRunId() !== null) {
    return c.json({ error: "A check is running — wait for it to finish, then clear again" }, 409);
  }
  let cleared = { entries: 0, runs: 0, clusters: 0, drafts: 0 };
  db.transaction(() => {
    cleared = {
      entries: db.prepare("DELETE FROM entries").run().changes,
      runs: db.prepare("DELETE FROM runs").run().changes,
      clusters: db.prepare("DELETE FROM clusters").run().changes,
      drafts: db.prepare("DELETE FROM threads WHERE posted_at IS NULL").run().changes,
    };
    db.prepare("DELETE FROM run_sources").run();
    db.prepare("DELETE FROM cluster_entries").run();
  })();
  const keptVoice = (db.prepare("SELECT COUNT(*) AS n FROM threads WHERE posted_at IS NOT NULL").get() as { n: number }).n;
  return c.json({ ok: true, cleared, keptVoice });
});

export default settings;
