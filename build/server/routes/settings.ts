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
  "check_interval",
  "telegram_chat_id",
  "floxy_host",
  "floxy_port",
  "floxy_username",
  "taste_prompt",
  "generation_prompt",
  "voice_examples_count",
  "trending_threshold",
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
    if (key === "check_interval" && !["15m", "30m", "1h", "3h"].includes(value))
      return c.json({ error: "Interval must be one of 15m, 30m, 1h, 3h" }, 400);
    if (key === "voice_examples_count" && !["3", "5", "10"].includes(value))
      return c.json({ error: "Voice examples count must be 3, 5, or 10" }, 400);
    if (key === "trending_threshold" && !/^[2-9]$/.test(value))
      return c.json({ error: "Trending threshold must be a number from 2 to 9" }, 400);
    updates.push([key, value]);
  }

  db.transaction(() => {
    for (const [key, value] of updates) setSetting(key, value);
  })();

  // Interval changes re-register the cron job immediately (scheduler reads it lazily
  // in M0; live re-registration lands with the scheduler milestone).
  const { onSettingsChanged } = await import("../scheduler");
  onSettingsChanged?.(Object.fromEntries(updates));

  return c.json({ ok: true });
});

export default settings;
