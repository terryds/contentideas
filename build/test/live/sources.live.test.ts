// Live smoke tests of the external fetch boundaries — the owner's REAL sources.
// Opt-in: `bun run test:live`. Fill test/live-sources.json first. These hit the
// real network and are allowed to be slow; they never gate the fast suite.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { fetchFeed } from "../../server/fetchers/rss";
import { hackerNewsFetcher } from "../../server/fetchers/hackernews";
import { resolveChannel, fetchChannelFeed } from "../../server/fetchers/youtube";
import { twitterFetcher, testAuth } from "../../server/fetchers/twitter";
import { setSetting } from "../../server/db/db";
import { migrate } from "../../server/db/migrate";
import type { NewEntry, SourceRow } from "../../server/fetchers/types";

const LIVE = !!process.env.LIVE;

interface LiveSources {
  rss: string[];
  youtube: string[];
  twitter: string[];
  hackernews: boolean;
}
const config = (await Bun.file(join(import.meta.dir, "..", "live-sources.json")).json()) as LiveSources;

function expectSaneEntries(entries: NewEntry[], label: string): void {
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.external_id, `${label}: entry missing external_id`).toBeTruthy();
    expect(entry.title, `${label}: entry missing title`).toBeTruthy();
    expect(entry.url, `${label}: entry missing url`).toMatch(/^https?:\/\//);
  }
}

describe.skipIf(!LIVE)("live: RSS feeds", () => {
  for (const url of config.rss) {
    test(url, async () => {
      const feed = await fetchFeed(url);
      expectSaneEntries(feed.entries, url);
    }, 30_000);
  }
});

describe.skipIf(!LIVE || !config.hackernews)("live: Hacker News front page", () => {
  test("top stories fetch and map", async () => {
    const entries = await hackerNewsFetcher.fetch({} as SourceRow);
    expectSaneEntries(entries, "hn");
    expect(entries.length).toBeGreaterThan(10);
    expect(entries[0].content).toMatch(/\d+ points/);
  }, 60_000);
});

describe.skipIf(!LIVE)("live: YouTube channels (detection feed — no proxy needed)", () => {
  for (const input of config.youtube) {
    test(input, async () => {
      const { channelId } = await resolveChannel(input);
      expect(channelId).toMatch(/^UC/);
      const feed = await fetchChannelFeed(channelId);
      expectSaneEntries(feed.entries, input);
    }, 60_000);
  }
});

// X needs cookies: export TWITTER_AUTH_TOKEN and TWITTER_CT0 before running.
const twitterReady = LIVE && !!process.env.TWITTER_AUTH_TOKEN && !!process.env.TWITTER_CT0;
describe.skipIf(!twitterReady || config.twitter.length === 0)("live: X profiles (twitter-cli)", () => {
  test("auth + profiles", async () => {
    migrate(); // temp DB — seed it with the env cookies for the fetcher to read
    setSetting("twitter_auth_token", process.env.TWITTER_AUTH_TOKEN!);
    setSetting("twitter_ct0", process.env.TWITTER_CT0!);
    const handle = await testAuth();
    expect(handle).toMatch(/^@/);
    for (const profile of config.twitter) {
      // Accept @handle or profile URL — same normalization the Sources route applies.
      const normalized = profile.trim().match(/@?([A-Za-z0-9_]{1,15})\s*$/)?.[1];
      expect(normalized, `${profile}: not a handle or profile URL`).toBeTruthy();
      const entries = await twitterFetcher.fetch({
        id: 0, type: "twitter", handle_or_url: `@${normalized}`, display_name: profile, channel_id: null, active: 1, created_at: "",
      });
      expectSaneEntries(entries, profile);
    }
  }, 120_000);
});
