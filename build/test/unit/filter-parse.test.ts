import { describe, expect, test } from "bun:test";
import { parseVerdict } from "../../server/llm/filter";

describe("parseVerdict", () => {
  test("MATCH with reason and topics", () => {
    const v = parseVerdict("MATCH: concrete numbers, fits AI economics\nTOPICS: gpt-6-release, openai");
    expect(v.matched).toBe(true);
    expect(v.reason).toBe("concrete numbers, fits AI economics");
    expect(v.topics).toEqual(["gpt-6-release", "openai"]);
  });

  test("SKIP with reason", () => {
    const v = parseVerdict("SKIP: listicle without a story\nTOPICS: some-topic, other-topic");
    expect(v.matched).toBe(false);
    expect(v.reason).toBe("listicle without a story");
  });

  test("missing TOPICS line never fails the verdict", () => {
    const v = parseVerdict("MATCH: still fine");
    expect(v.matched).toBe(true);
    expect(v.topics).toEqual([]);
  });

  test("tolerates em-dash separators and surrounding chatter", () => {
    const v = parseVerdict("Here is my judgment:\nMATCH — great fit\nTOPICS — Solo Founder Pricing, indie-hacking");
    expect(v.matched).toBe(true);
    // slugs are lowercased, space-hyphenated, sanitized
    expect(v.topics).toEqual(["solo-founder-pricing", "indie-hacking"]);
  });

  test("dedupes and caps topics at 4, drops 1-char junk", () => {
    const v = parseVerdict("MATCH: ok\nTOPICS: aa, aa, bb, cc, dd, ee, x");
    expect(v.topics).toEqual(["aa", "bb", "cc", "dd"]);
  });

  test("throws when no MATCH/SKIP verdict is present", () => {
    expect(() => parseVerdict("I think this is interesting content")).toThrow(/no MATCH\/SKIP verdict/);
  });

  test("TAGS are kept only when in the vocabulary", () => {
    const output = "MATCH: ok\nTOPICS: a-b, c-d\nTAGS: ai-coding, invented-tag, Indie Hacking";
    const v = parseVerdict(output, ["ai-coding", "indie-hacking"]);
    expect(v.tags).toEqual(["ai-coding", "indie-hacking"]); // normalized, invented dropped
    // empty vocabulary → tagging off, everything dropped
    expect(parseVerdict(output).tags).toEqual([]);
  });

  test("missing TAGS line never fails the verdict", () => {
    const v = parseVerdict("MATCH: fine\nTOPICS: a-b, c-d", ["ai-coding"]);
    expect(v.tags).toEqual([]);
  });
});
