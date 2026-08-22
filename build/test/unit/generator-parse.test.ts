import { describe, expect, test } from "bun:test";
import { normalizeTweets, truncateTranscript } from "../../server/llm/generator";

describe("normalizeTweets (schema-validated structured output)", () => {
  test("passes through a clean array", () => {
    expect(normalizeTweets(["one", "two", "three"])).toEqual(["one", "two", "three"]);
  });

  test("trims, drops empties/non-strings, caps at 10", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `  tweet ${i} `);
    const normalized = normalizeTweets([...twelve, "   ", 42]);
    expect(normalized).toHaveLength(10);
    expect(normalized[0]).toBe("tweet 0");
  });

  test("throws when nothing usable remains", () => {
    expect(() => normalizeTweets([])).toThrow(/no usable tweets/);
    expect(() => normalizeTweets(["   ", 42])).toThrow(/no usable tweets/);
    expect(() => normalizeTweets("not an array")).toThrow(/no usable tweets/);
  });
});

describe("truncateTranscript", () => {
  test("short transcripts pass through untouched", () => {
    expect(truncateTranscript("just a few words")).toBe("just a few words");
  });

  test("long transcripts keep head + middle sample and note the cut", () => {
    const words = Array.from({ length: 30_000 }, (_, i) => `w${i}`).join(" ");
    const out = truncateTranscript(words);
    expect(out).toContain("w0");
    expect(out).toContain("transcript truncated (30000 words total)");
    expect(out).toContain("w15000"); // middle sample starts at the midpoint
    expect(out.split(/\s+/).length).toBeLessThan(16_000);
  });

  test("respects a custom word budget (cluster drafts split it)", () => {
    const words = Array.from({ length: 5_000 }, (_, i) => `w${i}`).join(" ");
    const out = truncateTranscript(words, 1_000);
    expect(out.split(/\s+/).length).toBeLessThan(1_100);
  });
});
