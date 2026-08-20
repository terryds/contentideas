import { XMLParser } from "fast-xml-parser";
import type { Fetcher, NewEntry, SourceRow } from "./types";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Feeds in the wild are messy; keep parsing tolerant.
  processEntities: true,
  trimValues: true,
});

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>))
    return text((value as Record<string, unknown>)["#text"]);
  return "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    // html-escaped content (Atom type="html") arrives double-encoded; decode the common entities
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Parse an RSS 2.0 or Atom document into entries. Exported for reuse by source validation. */
export function parseFeed(xml: string): { title: string; entries: NewEntry[] } {
  const doc = parser.parse(xml);

  // RSS 2.0: rss.channel.item[]
  const channel = doc?.rss?.channel ?? doc?.["rdf:RDF"]?.channel;
  if (channel) {
    const items = asArray(channel.item ?? doc?.["rdf:RDF"]?.item);
    return {
      title: text(channel.title),
      entries: items.map((item: any): NewEntry => {
        const link = text(item.link) || text(item.guid);
        return {
          external_id: text(item.guid) || link || text(item.title),
          title: text(item.title) || "(untitled)",
          url: link,
          content: stripHtml(text(item.description) || text(item["content:encoded"])).slice(0, 2000),
        };
      }),
    };
  }

  // Atom: feed.entry[]
  const feed = doc?.feed;
  if (feed) {
    const entries = asArray(feed.entry);
    return {
      title: text(feed.title),
      entries: entries.map((entry: any): NewEntry => {
        const links = asArray(entry.link);
        const alternate =
          links.find((l: any) => l?.["@_rel"] === "alternate" || !l?.["@_rel"]) ?? links[0];
        const url = alternate?.["@_href"] ?? text(entry.link);
        return {
          external_id: text(entry.id) || url || text(entry.title),
          title: text(entry.title) || "(untitled)",
          url,
          content: stripHtml(text(entry.summary) || text(entry.content)).slice(0, 2000),
        };
      }),
    };
  }

  throw new Error("Not a recognizable RSS or Atom feed");
}

export async function fetchFeed(url: string): Promise<{ title: string; entries: NewEntry[] }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "content-engine/1.0 (personal RSS reader)" },
  });
  if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status} ${res.statusText}`);
  return parseFeed(await res.text());
}

export const rssFetcher: Fetcher = {
  async fetch(source: SourceRow): Promise<NewEntry[]> {
    return (await fetchFeed(source.handle_or_url)).entries;
  },
};
