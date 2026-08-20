import { describe, expect, test } from "bun:test";
import { normalizeUrlKey } from "../../server/trending/cluster";

describe("normalizeUrlKey", () => {
  test("strips tracking params, www, fragment, trailing slash", () => {
    expect(normalizeUrlKey("https://www.example.com/post/?utm_source=x&ref=hn#top")).toBe("example.com/post");
  });

  test("http and https produce the same key", () => {
    expect(normalizeUrlKey("http://example.com/post")).toBe(normalizeUrlKey("https://example.com/post"));
  });

  test("keeps meaningful params and sorts them", () => {
    expect(normalizeUrlKey("https://youtube.com/watch?v=abc&utm_campaign=z")).toBe("youtube.com/watch?v=abc");
    expect(normalizeUrlKey("https://a.com/x?b=2&a=1")).toBe("a.com/x?a=1&b=2");
  });

  test("strips fbclid, gclid, si", () => {
    expect(normalizeUrlKey("https://a.com/x?fbclid=1&gclid=2&si=3")).toBe("a.com/x");
  });

  test("bare domain normalizes to /", () => {
    expect(normalizeUrlKey("https://example.com")).toBe("example.com/");
  });

  test("null on unparseable input and null", () => {
    expect(normalizeUrlKey("not a url")).toBeNull();
    expect(normalizeUrlKey(null)).toBeNull();
  });
});
