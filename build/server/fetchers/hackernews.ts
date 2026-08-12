import type { Fetcher, NewEntry, SourceRow } from "./types";

// HN front page via the Firebase API. Slice size is a settings-free constant —
// top 30 ≈ the front page. Same story re-entering the top is deduped by item id.
const SLICE = 30;
const API = "https://hacker-news.firebaseio.com/v0";

interface HnItem {
  id: number;
  title?: string;
  url?: string;
  score?: number;
  descendants?: number;
  type?: string;
}

export const hackerNewsFetcher: Fetcher = {
  async fetch(_source: SourceRow): Promise<NewEntry[]> {
    const res = await fetch(`${API}/topstories.json`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HN topstories failed: HTTP ${res.status}`);
    const ids = ((await res.json()) as number[]).slice(0, SLICE);

    const items = await Promise.all(
      ids.map(async (id): Promise<HnItem | null> => {
        try {
          const itemRes = await fetch(`${API}/item/${id}.json`, { signal: AbortSignal.timeout(15_000) });
          if (!itemRes.ok) return null;
          return (await itemRes.json()) as HnItem;
        } catch {
          return null; // one missing item shouldn't fail the front page
        }
      }),
    );

    return items
      .filter((item): item is HnItem => !!item && !!item.title && item.type === "story")
      .map((item) => ({
        external_id: String(item.id),
        title: item.title!,
        url: `https://news.ycombinator.com/item?id=${item.id}`,
        content: [
          `${item.score ?? 0} points · ${item.descendants ?? 0} comments`,
          item.url ? `Article: ${item.url}` : "(text post on HN)",
        ].join("\n"),
      }));
  },
};
