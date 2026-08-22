import { describe, expect, test } from "bun:test";
import { sanitizePicks } from "../../server/llm/ranker";

const KEYS = ["entry:1", "entry:2", "cluster:3"];

describe("sanitizePicks", () => {
  test("keeps order, drops unknown keys and duplicates, caps at maxPicks", () => {
    const raw = {
      picks: [
        { key: "cluster:3", why: "cross-source" },
        { key: "entry:99", why: "hallucinated" },
        { key: "cluster:3", why: "again" },
        { key: "entry:1", why: "solid" },
        { key: "entry:2", why: "also fine" },
      ],
    };
    expect(sanitizePicks(raw, KEYS, 2)).toEqual([
      { key: "cluster:3", why: "cross-source" },
      { key: "entry:1", why: "solid" },
    ]);
  });

  test("zero picks is valid; garbage shapes yield empty", () => {
    expect(sanitizePicks({ picks: [] }, KEYS, 3)).toEqual([]);
    expect(sanitizePicks(null, KEYS, 3)).toEqual([]);
    expect(sanitizePicks({ picks: "nope" }, KEYS, 3)).toEqual([]);
  });
});
