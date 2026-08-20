// Live round-trip of the real `claude -p` contracts. Opt-in and slow.

import { describe, expect, test } from "bun:test";
import { migrate } from "../../server/db/migrate";
import { filterEntry } from "../../server/llm/filter";

const LIVE = !!process.env.LIVE;

describe.skipIf(!LIVE)("live: claude -p filter contract", () => {
  test("returns a verdict, a reason, and canonical topic slugs", async () => {
    delete process.env.CONTENT_ENGINE_CLAUDE_BIN; // ensure the real CLI, not a stub from another file
    migrate(); // seeds the default taste prompt in the temp DB
    const verdict = await filterEntry({
      title: "OpenAI releases GPT-6 with 10x cheaper inference — full pricing breakdown",
      source_label: "hn:frontpage",
      content: "412 points · 220 comments. Detailed cost numbers for the new API tiers.",
    });
    expect(typeof verdict.matched).toBe("boolean");
    expect(verdict.reason.length).toBeGreaterThan(0);
    expect(verdict.topics.length).toBeGreaterThanOrEqual(2);
    expect(verdict.topics.every((t) => /^[a-z0-9-]+$/.test(t))).toBe(true);
  }, 120_000);
});
