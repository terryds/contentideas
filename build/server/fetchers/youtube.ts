import { XMLParser } from "fast-xml-parser";
import type { Fetcher, NewEntry, SourceRow } from "./types";

// Detection only — via the channel's public RSS feed. Transcripts are fetched
// separately (transcript.ts, through the Floxy proxy) and only after a match.

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export function feedUrl(channelId: string): string {
  return `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
}

/**
 * Resolve user input (youtube.com/@handle, bare @handle, /channel/UC… URL, or a raw
 * UC… id) to a channel id. Handle resolution scrapes the channel page for its
 * canonical channel id; may hit bot protection — caller surfaces the error inline.
 */
export async function resolveChannel(input: string): Promise<{ channelId: string; handle: string | null }> {
  const trimmed = input.trim();

  const idMatch = trimmed.match(/(UC[0-9A-Za-z_-]{22})/);
  if (idMatch) return { channelId: idMatch[1], handle: null };

  const handleMatch = trimmed.match(/@([A-Za-z0-9._-]+)/);
  if (!handleMatch) {
    throw new Error("Enter a YouTube handle (@channel), channel URL, or channel id (UC…)");
  }
  const handle = `@${handleMatch[1]}`;

  const res = await fetch(`https://www.youtube.com/${handle}`, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Could not resolve ${handle}: YouTube returned HTTP ${res.status}`);
  const html = await res.text();
  const found = html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/) ?? html.match(/channel\/(UC[0-9A-Za-z_-]{22})/);
  if (!found) throw new Error(`Could not find a channel id for ${handle} on its page`);
  return { channelId: found[1], handle };
}

/** Fetch + parse the channel feed. Returns channel title too (used at source-add time). */
export async function fetchChannelFeed(channelId: string): Promise<{ title: string; entries: NewEntry[] }> {
  const res = await fetch(feedUrl(channelId), {
    signal: AbortSignal.timeout(20_000),
    headers: { "user-agent": "content-engine/1.0" },
  });
  if (!res.ok) throw new Error(`Channel feed failed: HTTP ${res.status}`);
  const doc = parser.parse(await res.text());
  const feed = doc?.feed;
  if (!feed) throw new Error("Channel feed was not valid Atom XML");
  const entries = asArray(feed.entry).map((entry: any): NewEntry => {
    const videoId = String(entry["yt:videoId"] ?? "");
    return {
      external_id: videoId || String(entry.id ?? ""),
      title: String(entry.title ?? "(untitled)"),
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : "",
      content: String(entry["media:group"]?.["media:description"] ?? "").slice(0, 2000),
    };
  });
  return { title: String(feed.title ?? ""), entries };
}

export const youtubeFetcher: Fetcher = {
  async fetch(source: SourceRow): Promise<NewEntry[]> {
    if (!source.channel_id) throw new Error("Source has no channel id — re-add this channel");
    return (await fetchChannelFeed(source.channel_id)).entries;
  },
};
