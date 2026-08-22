import { describe, expect, test } from "bun:test";
import { composeMatchDigest, composeTrendingDigest } from "../../server/notify/telegram";

describe("composeMatchDigest", () => {
  test("one bullet per match: bold headline, source hyperlinked, reason as summary", () => {
    const digest = composeMatchDigest([
      { title: "Big story", source_label: "hn:frontpage", filter_reason: "concrete numbers", url: "https://a.com/x" },
      { title: "Other", source_label: "rss:swyx.io", filter_reason: null, url: null },
    ]);
    expect(digest).toStartWith("🔎 2 new matches");
    expect(digest).toContain('• <b>Big story</b> — <a href="https://a.com/x">hn:frontpage</a>\nconcrete numbers');
    expect(digest).toContain("• <b>Other</b> — rss:swyx.io"); // no url → plain label, no reason line
  });

  test("tags render as Telegram-safe hashtags", () => {
    const digest = composeMatchDigest([
      { title: "T", source_label: "s", filter_reason: "fits", url: null, tags: ["ai-coding", "indie-hacking"] },
    ]);
    expect(digest).toContain("#ai_coding #indie_hacking");
  });

  test("singular header for one match", () => {
    expect(composeMatchDigest([{ title: "T", source_label: "s", filter_reason: null, url: null }])).toStartWith(
      "🔎 1 new match\n",
    );
  });

  test("HTML in titles/reasons/urls is escaped", () => {
    const digest = composeMatchDigest([
      { title: "a <b>&</b> c", source_label: "x:@a&b", filter_reason: "1 < 2", url: 'https://a.com/?q="x"&y=1' },
    ]);
    expect(digest).toContain("<b>a &lt;b&gt;&amp;&lt;/b&gt; c</b>");
    expect(digest).toContain('href="https://a.com/?q=&quot;x&quot;&amp;y=1"');
    expect(digest).toContain("x:@a&amp;b");
    expect(digest).toContain("1 &lt; 2");
  });

  test("overflow past 20 bullets becomes a count line", () => {
    const entries = Array.from({ length: 27 }, (_, i) => ({
      title: `Match ${i}`, source_label: "hn:frontpage", filter_reason: "fits", url: "https://a.com",
    }));
    const digest = composeMatchDigest(entries);
    expect(digest.match(/• /g)?.length).toBe(20);
    expect(digest).toContain("…and 7 more matches — see your Inbox");
    expect(digest.length).toBeLessThan(4096);
  });
});

describe("composeTrendingDigest", () => {
  test("one bullet per cluster, member labels deduped and hyperlinked", () => {
    const digest = composeTrendingDigest([
      {
        title: "GPT-6 ships",
        members: [
          { label: "hn:frontpage", url: "https://news.ycombinator.com/item?id=1" },
          { label: "hn:frontpage", url: "https://news.ycombinator.com/item?id=2" }, // same label → deduped
          { label: "rss:swyx.io", url: "https://swyx.io/gpt6" },
        ],
      },
    ]);
    expect(digest).toStartWith("📈 1 trending story in your sources");
    expect(digest).toContain("• <b>GPT-6 ships</b>");
    expect(digest.match(/hn:frontpage/g)?.length).toBe(1);
    expect(digest).toContain('<a href="https://swyx.io/gpt6">rss:swyx.io</a>');
  });

  test("plural header", () => {
    const digest = composeTrendingDigest([
      { title: "A", members: [{ label: "x", url: null }] },
      { title: "B", members: [{ label: "y", url: null }] },
    ]);
    expect(digest).toStartWith("📈 2 trending stories in your sources");
  });
});
