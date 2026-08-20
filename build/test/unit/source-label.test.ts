import { describe, expect, test } from "bun:test";
import { sourceLabel, type SourceRow } from "../../server/fetchers/types";

const source = (type: SourceRow["type"], handle_or_url: string): SourceRow => ({
  id: 1, type, handle_or_url, display_name: "", channel_id: null, active: 1, created_at: "",
});

describe("sourceLabel", () => {
  test("hn is a fixed label", () => {
    expect(sourceLabel(source("hn", "https://news.ycombinator.com"))).toBe("hn:frontpage");
  });
  test("youtube keeps the @handle", () => {
    expect(sourceLabel(source("youtube", "youtube.com/@t3dotgg"))).toBe("yt:@t3dotgg");
  });
  test("twitter always gets an @", () => {
    expect(sourceLabel(source("twitter", "levelsio"))).toBe("x:@levelsio");
    expect(sourceLabel(source("twitter", "@levelsio"))).toBe("x:@levelsio");
  });
  test("rss uses the hostname without www", () => {
    expect(sourceLabel(source("rss", "https://www.swyx.io/feed.xml"))).toBe("rss:swyx.io");
  });
});
