import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseTimedText } from "../../server/fetchers/transcript";

describe("parseTimedText", () => {
  test("groups segments into [mm:ss] blocks, skipping blank events", async () => {
    const data = await Bun.file(join(import.meta.dir, "..", "fixtures", "timedtext.json")).json();
    const transcript = parseTimedText(data);
    const blocks = transcript.split("\n\n");
    expect(blocks).toHaveLength(2); // 0s–9s block, then the >20s gap starts a new one
    expect(blocks[0]).toStartWith("[00:00] so last weekend I did something objectively stupid");
    expect(blocks[0]).toContain("billing service");
    expect(blocks[1]).toStartWith("[00:25] the total API bill came to $41");
  });

  test("throws on empty payloads", () => {
    expect(() => parseTimedText({})).toThrow(/no segments/);
    expect(() => parseTimedText({ events: [{ tStartMs: 0, segs: [{ utf8: " " }] }] })).toThrow(/empty/);
  });
});
