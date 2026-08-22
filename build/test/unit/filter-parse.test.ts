import { describe, expect, test } from "bun:test";
import { normalizeVerdict, sanitizeTags } from "../../server/llm/filter";

describe("normalizeVerdict (schema-validated structured output)", () => {
  test("passes through a clean verdict", () => {
    const v = normalizeVerdict(
      { matched: true, reason: "concrete numbers", topics: ["gpt-6-release", "openai"], tags: [] },
    );
    expect(v.matched).toBe(true);
    expect(v.reason).toBe("concrete numbers");
    expect(v.topics).toEqual(["gpt-6-release", "openai"]);
  });

  test("sanitizes topic slugs: lowercase, hyphenated, deduped, capped at 4", () => {
    const v = normalizeVerdict({
      matched: false,
      reason: "r",
      topics: ["Solo Founder Pricing", "solo-founder-pricing", "A B", "c!!d", "e-e", "f-f"],
      tags: [],
    });
    expect(v.topics).toEqual(["solo-founder-pricing", "a-b", "cd", "e-e"]);
  });

  test("tags survive only when in the vocabulary", () => {
    const v = normalizeVerdict(
      { matched: true, reason: "r", topics: ["a-b"], tags: ["ai-coding", "invented-tag", "Indie Hacking"] },
      ["ai-coding", "indie-hacking"],
    );
    expect(v.tags).toEqual(["ai-coding", "indie-hacking"]);
    // no vocabulary → tagging off
    expect(normalizeVerdict({ matched: true, reason: "r", topics: [], tags: ["ai-coding"] }).tags).toEqual([]);
  });

  test("blank reason falls back to matched/skipped; missing arrays tolerated", () => {
    expect(normalizeVerdict({ matched: true, reason: "  " }).reason).toBe("matched");
    expect(normalizeVerdict({ matched: false }).topics).toEqual([]);
  });

  test("score is clamped to 1-10 integers; missing/garbage becomes null", () => {
    expect(normalizeVerdict({ matched: true, score: 7 }).score).toBe(7);
    expect(normalizeVerdict({ matched: true, score: 14 }).score).toBe(10);
    expect(normalizeVerdict({ matched: true, score: 0.4 }).score).toBe(1);
    expect(normalizeVerdict({ matched: true }).score).toBeNull();
    expect(normalizeVerdict({ matched: true, score: "high" }).score).toBeNull();
  });

  test("throws when matched is not a boolean", () => {
    expect(() => normalizeVerdict({ reason: "no verdict" })).toThrow(/no boolean/);
  });
});

describe("sanitizeTags", () => {
  test("normalizes then filters against the vocabulary", () => {
    expect(sanitizeTags(["AI Coding", "drama", "DRAMA"], ["ai-coding", "drama"])).toEqual(["ai-coding", "drama"]);
    expect(sanitizeTags(["anything"], [])).toEqual([]);
  });
});
