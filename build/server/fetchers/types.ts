export type SourceType = "youtube" | "twitter" | "hn" | "rss";

export interface SourceRow {
  id: number;
  type: SourceType;
  handle_or_url: string;
  display_name: string;
  channel_id: string | null;
  active: number;
  created_at: string;
}

export interface NewEntry {
  external_id: string;
  title: string;
  url: string;
  content: string;
  /** A link the entry points AT (e.g. a tweet's first embedded URL). When set,
   * trending's url_key is computed from this instead of `url`, so different
   * sources discussing the same page cluster together. */
  embedded_url?: string | null;
}

export interface Fetcher {
  fetch(source: SourceRow): Promise<NewEntry[]>;
}

/** Short mono label used across run history and entry cards, e.g. "rss:swyx.io". */
export function sourceLabel(source: SourceRow): string {
  switch (source.type) {
    case "hn":
      return "hn:frontpage";
    case "youtube":
      return `yt:${source.handle_or_url.replace(/^.*@/, "@")}`;
    case "twitter":
      return `x:${source.handle_or_url.startsWith("@") ? source.handle_or_url : "@" + source.handle_or_url}`;
    case "rss": {
      try {
        return `rss:${new URL(source.handle_or_url).hostname.replace(/^www\./, "")}`;
      } catch {
        return `rss:${source.handle_or_url}`;
      }
    }
  }
}
