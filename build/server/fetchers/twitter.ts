import { getSetting } from "../db/db";
import type { Fetcher, NewEntry, SourceRow } from "./types";

// twitter-cli subprocess. Cookies come from settings and are passed as env vars
// only — never argv (argv is visible in `ps`), never logged.

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
    proc = Bun.spawn(["twitter-cli", ...args], { env, stdout: "pipe", stderr: "pipe" });
  } catch {
    throw new Error("twitter-cli not found on PATH — install it to fetch X profiles");
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
    if (/401|unauthoriz|forbidden|expired|login/i.test(detail)) {
      throw new Error(`Twitter auth rejected — cookies may have expired. Re-copy them from your browser. (${detail})`);
    }
    throw new Error(`twitter-cli exited ${exitCode}: ${detail || "no output"}`);
  }
  return stdout;
}

/** Settings "Test auth": whoami-equivalent. Returns the logged-in handle. */
export async function testAuth(): Promise<string> {
  const out = await runCli(["whoami"]);
  const handle = out.match(/@[A-Za-z0-9_]{1,15}/)?.[0];
  if (!handle) throw new Error(`twitter-cli returned unexpected output: ${out.slice(0, 120)}`);
  return handle;
}

export const twitterFetcher: Fetcher = {
  async fetch(source: SourceRow): Promise<NewEntry[]> {
    const handle = source.handle_or_url.replace(/^@/, "");
    // Exact subcommand pinned during M6 (spec open question): `tweets <handle>`
    // with JSON output is the assumed shape; parse defensively and fail loudly
    // rather than ingest garbage.
    const out = await runCli(["tweets", handle, "--json"]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(out);
    } catch {
      throw new Error(`twitter-cli output was not JSON (format may have changed): ${out.slice(0, 120)}`);
    }
    const list = Array.isArray(parsed) ? parsed : (parsed as { tweets?: unknown[] })?.tweets;
    if (!Array.isArray(list)) throw new Error("twitter-cli JSON had no tweet array (format may have changed)");

    const entries: NewEntry[] = [];
    for (const raw of list) {
      const tweet = raw as { id?: unknown; id_str?: unknown; text?: unknown; full_text?: unknown; is_retweet?: boolean; in_reply_to?: unknown };
      const id = String(tweet.id_str ?? tweet.id ?? "");
      const text = String(tweet.full_text ?? tweet.text ?? "").trim();
      if (!id || !text) continue;
      if (tweet.is_retweet || text.startsWith("RT @")) continue; // skip retweets
      if (tweet.in_reply_to || text.startsWith("@")) continue; // skip replies
      entries.push({
        external_id: id,
        title: text.length > 90 ? `${text.slice(0, 90)}…` : text,
        url: `https://x.com/${handle}/status/${id}`,
        content: text,
      });
    }
    return entries;
  },
};
