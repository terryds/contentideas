import { describe, expect, test } from "bun:test";
import { parseThread, truncateTranscript } from "../../server/llm/generator";

describe("parseThread", () => {
  test("plain JSON array", () => {
    expect(parseThread('["one", "two", "three"]')).toEqual(["one", "two", "three"]);
  });

  test("strips code fences", () => {
    expect(parseThread('```json\n["a", "b"]\n```')).toEqual(["a", "b"]);
  });

  test("extracts the array out of surrounding commentary", () => {
    expect(parseThread('Here is your thread:\n["a", "b"]\nHope you like it!')).toEqual(["a", "b"]);
  });

  test("trims tweets and caps at 10", () => {
    const twelve = JSON.stringify(Array.from({ length: 12 }, (_, i) => `  tweet ${i} `));
    const parsed = parseThread(twelve);
    expect(parsed).toHaveLength(10);
    expect(parsed[0]).toBe("tweet 0");
  });

  test("throws on empty array, non-array, non-string members", () => {
    expect(() => parseThread("[]")).toThrow();
    expect(() => parseThread("no array here")).toThrow(/not a JSON array/);
    expect(() => parseThread('["ok", 42]')).toThrow();
    expect(() => parseThread('["ok", "   "]')).toThrow();
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
