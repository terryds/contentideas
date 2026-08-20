import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseTweets } from "../../server/fetchers/twitter";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "..", "fixtures", name)).text();

describe("parseTweets (real CLI envelope: {ok, data: [...]})", () => {
  test("keeps originals; skips retweets (flag + RT prefix), replies, and empty tweets", async () => {
    const entries = parseTweets(await fixture("twitter.json"), "levelsio");
    expect(entries.map((e) => e.external_id)).toEqual(["1001", "1002", "1006"]);
    expect(entries[0].url).toBe("https://x.com/levelsio/status/1001");
    expect(entries[0].content).toContain("doubling prices");
  });

  test("first embedded URL is surfaced for trending's url_key", async () => {
    const entries = parseTweets(await fixture("twitter.json"), "levelsio");
    expect(entries[0].embedded_url).toBeNull();
    expect(entries[1].embedded_url).toBe("https://example.com/local-first?utm_source=t.co");
  });

  test("quoted tweet text is appended as filter context", async () => {
    const entries = parseTweets(await fixture("twitter.json"), "levelsio");
    const quoting = entries.find((e) => e.external_id === "1006")!;
    expect(quoting.content).toContain("Quoting @swyx: The original quoted wisdom.");
    expect(quoting.title).toBe("Quoting something interesting"); // title stays the tweet's own first line
  });

  test("long first lines get an ellipsized title, full text in content", () => {
    const long = "x".repeat(120);
    const out = JSON.stringify({ ok: true, data: [{ id: "1", text: long }] });
    const entries = parseTweets(out, "h");
    expect(entries[0].title.length).toBe(91); // 90 chars + ellipsis
    expect(entries[0].title.endsWith("…")).toBe(true);
    expect(entries[0].content).toBe(long);
  });

  test("legacy shapes still parse: bare array, {tweets: []}, id_str/full_text", () => {
    expect(parseTweets(JSON.stringify([{ id_str: "9", full_text: "hello world" }]), "h")).toHaveLength(1);
    expect(parseTweets(JSON.stringify({ tweets: [{ id: "9", text: "hello" }] }), "h")).toHaveLength(1);
  });

  test("fails loudly on non-JSON, ok:false, and JSON without a tweet array", () => {
    expect(() => parseTweets("rate limited, try later", "h")).toThrow(/not JSON/);
    expect(() => parseTweets('{"ok": false, "error": "session expired"}', "h")).toThrow(/session expired/);
    expect(() => parseTweets('{"data": {}}', "h")).toThrow(/no tweet array/);
  });
});
