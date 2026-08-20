import { describe, expect, test, beforeEach } from "bun:test";
import { createApp } from "../../server/app";
import { resetDb } from "../helpers";

const app = createApp();

const putSettings = (body: Record<string, string>) =>
  app.request("/api/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("settings API", () => {
  beforeEach(resetDb);

  test("secrets are write-only: GET reports presence, never values", async () => {
    let data = (await app.request("/api/settings").then((r) => r.json())) as {
      values: Record<string, string | null>;
      secrets: Record<string, { set: boolean }>;
    };
    expect(data.secrets.telegram_bot_token).toEqual({ set: false });

    expect((await putSettings({ telegram_bot_token: "12345:secret-token" })).status).toBe(200);
    data = (await app.request("/api/settings").then((r) => r.json())) as typeof data;
    expect(data.secrets.telegram_bot_token).toEqual({ set: true });
    expect(JSON.stringify(data)).not.toContain("secret-token");
  });

  test("validation: interval, chat id, threshold, unknown keys", async () => {
    expect((await putSettings({ check_interval: "7m" })).status).toBe(400);
    expect((await putSettings({ telegram_chat_id: "abc" })).status).toBe(400);
    expect((await putSettings({ trending_threshold: "1" })).status).toBe(400);
    expect((await putSettings({ trending_threshold: "10" })).status).toBe(400);
    expect((await putSettings({ trending_threshold: "3" })).status).toBe(200);
    expect((await putSettings({ made_up_key: "x" })).status).toBe(400);
  });
});

describe("entries & clusters API", () => {
  beforeEach(resetDb);

  test("inbox payload has entries, counts, and clusters", async () => {
    const data = (await app.request("/api/entries").then((r) => r.json())) as Record<string, unknown>;
    expect(Array.isArray(data.entries)).toBe(true);
    expect(Array.isArray(data.counts)).toBe(true);
    expect(Array.isArray(data.clusters)).toBe(true);
  });

  test("404s: unknown entry, cluster, thread; unmatched API path", async () => {
    expect((await app.request("/api/entries/999")).status).toBe(404);
    expect((await app.request("/api/entries/999/dismiss", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/clusters/999")).status).toBe(404);
    expect((await app.request("/api/clusters/999/dismiss", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/threads/999/posted", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/nonsense")).status).toBe(404);
  });

  test("sources API rejects bad input without touching the DB", async () => {
    const bad = await app.request("/api/sources", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "rss", input: "not-a-url" }),
    });
    expect(bad.status).toBe(400);
    const list = (await app.request("/api/sources").then((r) => r.json())) as { sources: unknown[] };
    expect(list.sources).toHaveLength(0);
  });
});
