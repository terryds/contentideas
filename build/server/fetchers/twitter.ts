import { getSetting } from "../db/db";
import type { Fetcher, NewEntry, SourceRow } from "./types";

// `twitter` CLI subprocess (the twitter-cli project installs its binary as
// `twitter`). Cookies come from settings and are passed as env vars only —
// never argv (argv is visible in `ps`), never logged.
// Interface pinned against the real CLI (see spec/plans/ingestion.md):
//   twitter user-posts <handle> --json   → {ok, data: [tweet, …]}
//   twitter whoami --json                → {ok, data: {user: {screenName}}}

function credentials(): { TWITTER_AUTH_TOKEN: string; TWITTER_CT0: string } {
  const authToken = getSetting("twitter_auth_token");
  const ct0 = getSetting("twitter_ct0");
  if (!authToken || !ct0) {
    throw new Error("Twitter not configured — add TWITTER_AUTH_TOKEN and TWITTER_CT0 in Settings");
  }
  return { TWITTER_AUTH_TOKEN: authToken, TWITTER_CT0: ct0 };
}

async function runCli(args: string[], timeoutMs = 45_000): Promise<string> {
  const env = { ...process.env, ...credentials() };
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn(["twitter", ...args], { env, stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("`twitter` CLI not found on PATH — install twitter-cli to fetch X profiles");
  }
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  if (exitCode !== 0) {
    const detail = (stderr || stdout).trim().split("\n").slice(0, 3).join(" ");
    if (/401|unauthoriz|forbidden|expired|login|not authenticated/i.test(detail)) {
      throw new Error(`Twitter auth rejected — cookies may have expired. Re-copy them from your browser. (${detail})`);
    }
    throw new Error(`twitter CLI exited ${exitCode}: ${detail || "no output"}`);
  }
  return stdout;
}

/** Unwrap the CLI's {ok, data} envelope; tolerate a bare payload for older versions. */
function unwrap(out: string, what: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`twitter CLI output was not JSON (format may have changed): ${out.slice(0, 120)}`);
  }
  const envelope = parsed as { ok?: boolean; error?: string; data?: unknown };
  if (envelope && typeof envelope === "object" && "ok" in envelope) {
    if (!envelope.ok) throw new Error(`twitter CLI reported failure: ${envelope.error ?? "unknown error"}`);
    return envelope.data;
  }
  if (parsed == null) throw new Error(`twitter CLI returned no ${what}`);
  return parsed;
}

/** Settings "Test auth": whoami. Returns the logged-in handle. */
export async function testAuth(): Promise<string> {
  const data = unwrap(await runCli(["whoami", "--json"]), "profile") as {
    user?: { screenName?: string; username?: string };
    screenName?: string;
  };
  const handle = data?.user?.screenName ?? data?.user?.username ?? data?.screenName;
  if (!handle) throw new Error("twitter whoami returned no screen name (format may have changed)");
  return `@${String(handle).replace(/^@/, "")}`;
}

interface CliTweet {
  id?: unknown;
  id_str?: unknown;
  text?: unknown;
  full_text?: unknown;
  isRetweet?: boolean;
  is_retweet?: boolean;
  inReplyTo?: unknown;
  in_reply_to?: unknown;
  urls?: unknown[];
  quotedTweet?: { text?: unknown; author?: { screenName?: unknown } };
}

function firstUrl(urls: unknown[] | undefined): string | null {
  const first = urls?.[0];
  if (!first) return null;
  if (typeof first === "string") return first;
  const obj = first as { expandedUrl?: unknown; expanded_url?: unknown; url?: unknown };
  const candidate = obj.expandedUrl ?? obj.expanded_url ?? obj.url;
  return typeof candidate === "string" ? candidate : null;
}

/** Parse twitter CLI JSON output into entries. Pure — exported for tests. */
export function parseTweets(out: string, handle: string): NewEntry[] {
  const data = unwrap(out, "tweets");
  const list = Array.isArray(data) ? data : (data as { tweets?: unknown[] })?.tweets;
  if (!Array.isArray(list)) throw new Error("twitter CLI JSON had no tweet array (format may have changed)");

  const entries: NewEntry[] = [];
  for (const raw of list) {
    const tweet = raw as CliTweet;
    const id = String(tweet.id_str ?? tweet.id ?? "");
    let text = String(tweet.full_text ?? tweet.text ?? "").trim();
    if (!id || !text) continue;
    if (tweet.isRetweet || tweet.is_retweet || text.startsWith("RT @")) continue; // skip retweets
    if (tweet.inReplyTo || tweet.in_reply_to || text.startsWith("@")) continue; // skip replies

    // Quoted tweet text is real context for the taste filter.
    const quoted = tweet.quotedTweet;
    if (quoted?.text) {
      const by = quoted.author?.screenName ? ` @${quoted.author.screenName}` : "";
      text += `\n\nQuoting${by}: ${String(quoted.text).trim()}`;
    }

    const firstLine = text.split("\n")[0];
    entries.push({
      external_id: id,
      title: firstLine.length > 90 ? `${firstLine.slice(0, 90)}…` : firstLine,
      url: `https://x.com/${handle}/status/${id}`,
      content: text,
      // First embedded link — trending's url_key prefers it, so a tweet linking
      // an article clusters with the HN/RSS entries for the same article.
      embedded_url: firstUrl(tweet.urls),
    });
  }
  return entries;
}

export const twitterFetcher: Fetcher = {
  async fetch(source: SourceRow): Promise<NewEntry[]> {
    const handle = source.handle_or_url.replace(/^@/, "");
    return parseTweets(await runCli(["user-posts", handle, "--json", "-n", "30"]), handle);
  },
};
