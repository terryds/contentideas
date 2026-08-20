import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseFeed } from "../../server/fetchers/rss";

const fixture = (name: string) => Bun.file(join(import.meta.dir, "..", "fixtures", name)).text();

describe("parseFeed — RSS 2.0", () => {
  test("parses channel title and items, strips HTML/entities from descriptions", async () => {
    const feed = parseFeed(await fixture("rss2.xml"));
    expect(feed.title).toBe("swyx writing");
    expect(feed.entries).toHaveLength(2);

    const [first, second] = feed.entries;
    expect(first.external_id).toBe("swyx-001");
    expect(first.title).toBe("Ship small, ship weekly & other lessons");
    expect(first.url).toBe("https://swyx.io/ship-small?utm_source=rss");
    expect(first.content).toBe("A case study on shipping cadence with numbers.");

    // content:encoded is the fallback when description is absent
    expect(second.content).toBe("Long form content here.");
  });
});

describe("parseFeed — Atom", () => {
  test("parses entries, prefers rel=alternate links", async () => {
    const feed = parseFeed(await fixture("atom.xml"));
    expect(feed.title).toBe("Example Atom Blog");
    expect(feed.entries).toHaveLength(2);

    const [first, second] = feed.entries;
    expect(first.external_id).toBe("tag:example.org,2026:post-1");
    expect(first.url).toBe("https://example.org/local-first"); // not the enclosure
    expect(first.content).toBe("Why local-first architectures win.");

    expect(second.url).toBe("https://example.org/single");
    expect(second.content).toContain("HTML content with & entities.");
  });
});

describe("parseFeed — garbage", () => {
  test("throws a recognizable error on non-feed input", () => {
    expect(() => parseFeed("<html><body>not a feed</body></html>")).toThrow(/not a recognizable/i);
  });
});
