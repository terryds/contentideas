import { buildProxySession } from "../proxy/floxy";

// The ONLY file that knows how transcripts are fetched.
//
// Library trial (2026-08-12): `youtube-transcript` and `youtubei.js` both wrap
// the same two-step flow (player response → timedtext captions), but neither
// lets us swap the proxy per request — and the spec demands a FRESH Floxy
// session (new IP) per attempt. So the flow is implemented directly with Bun's
// per-call `proxy` fetch option:
//   1. Innertube WEB player endpoint → caption track list
//      (fallback: scrape ytInitialPlayerResponse off the watch page)
//   2. timedtext baseUrl + fmt=json3 → segments
// Verified from this build box that both steps answer 200 but flag a
// datacenter IP with LOGIN_REQUIRED ("Sign in to confirm you're not a bot") —
// exactly the block Floxy's residential IPs exist to clear.

const ATTEMPTS = 3;
const BACKOFF_MS = [0, 3_000, 8_000];
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export class TranscriptError extends Error {
  trace: string[];
  constructor(message: string, trace: string[]) {
    super(message);
    this.trace = trace;
  }
}

async function playerCaptionTracks(videoId: string, proxyUrl: string): Promise<CaptionTrack[]> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en" } },
      videoId,
    }),
    proxy: proxyUrl,
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 407) throw new Error("Floxy returned 407 Proxy Authentication Required");
  if (!res.ok) throw new Error(`player endpoint HTTP ${res.status}`);
  const data = (await res.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  };
  const status = data.playabilityStatus?.status;
  if (status === "LOGIN_REQUIRED") {
    throw new Error(`bot check (${data.playabilityStatus?.reason ?? "login required"}) — session IP not accepted`);
  }
  const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) {
    // Some player responses omit captions; the watch page often still has them.
    return watchPageCaptionTracks(videoId, proxyUrl);
  }
  return tracks;
}

async function watchPageCaptionTracks(videoId: string, proxyUrl: string): Promise<CaptionTrack[]> {
  const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    proxy: proxyUrl,
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 407) throw new Error("Floxy returned 407 Proxy Authentication Required");
  if (!res.ok) throw new Error(`watch page HTTP ${res.status}`);
  const html = await res.text();
  const match = html.match(/"captionTracks":(\[.*?\])(?=,")/s);
  if (!match) {
    if (html.includes("LOGIN_REQUIRED")) throw new Error("bot check on watch page — session IP not accepted");
    throw new Error("no caption tracks — the video may have no transcript");
  }
  return JSON.parse(match[1]) as CaptionTrack[];
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  // Prefer human English captions, then auto English, then anything.
  return (
    tracks.find((t) => t.languageCode.startsWith("en") && t.kind !== "asr") ??
    tracks.find((t) => t.languageCode.startsWith("en")) ??
    tracks[0]
  );
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `[${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}]`;
}

export interface TimedTextData {
  events?: { tStartMs?: number; segs?: { utf8?: string }[] }[];
}

/** Pure parse of a timedtext json3 payload — exported for testability. */
export function parseTimedText(data: TimedTextData): string {
  if (!data.events?.length) throw new Error("timedtext response had no segments");

  // Group segments into ~20s blocks with a [mm:ss] marker each.
  const blocks: string[] = [];
  let blockStart = -1;
  let blockText: string[] = [];
  for (const event of data.events) {
    const text = event.segs?.map((s) => s.utf8 ?? "").join("") ?? "";
    if (!text.trim()) continue;
    const start = event.tStartMs ?? 0;
    if (blockStart === -1) blockStart = start;
    if (start - blockStart > 20_000) {
      blocks.push(`${formatMs(blockStart)} ${blockText.join(" ").replace(/\s+/g, " ").trim()}`);
      blockStart = start;
      blockText = [];
    }
    blockText.push(text);
  }
  if (blockText.length) {
    blocks.push(`${formatMs(blockStart)} ${blockText.join(" ").replace(/\s+/g, " ").trim()}`);
  }
  const transcript = blocks.join("\n\n");
  if (!transcript.trim()) throw new Error("transcript was empty after parsing");
  return transcript;
}

async function fetchTimedText(track: CaptionTrack, proxyUrl: string): Promise<string> {
  const url = `${track.baseUrl}${track.baseUrl.includes("?") ? "&" : "?"}fmt=json3`;
  const res = await fetch(url, {
    headers: { "user-agent": UA },
    proxy: proxyUrl,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`timedtext HTTP ${res.status}`);
  return parseTimedText((await res.json()) as TimedTextData);
}

/**
 * Fetch a transcript for a YouTube entry. Fresh Floxy session (new IP) per
 * attempt, 3 attempts with backoff. Throws TranscriptError carrying the
 * human-readable attempt trace for run history.
 */
export async function fetchTranscriptForEntry(entry: {
  external_id: string;
  url: string | null;
}): Promise<string | null> {
  const videoId = entry.external_id.match(/^[0-9A-Za-z_-]{11}$/)
    ? entry.external_id
    : entry.url?.match(/[?&]v=([0-9A-Za-z_-]{11})/)?.[1];
  if (!videoId) throw new Error(`Cannot determine video id for entry ${entry.external_id}`);

  const trace: string[] = [];
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt - 1]) await Bun.sleep(BACKOFF_MS[attempt - 1]);
    const session = buildProxySession(); // throws "not configured" — caller surfaces it
    const stamp = new Date().toISOString().slice(11, 19);
    try {
      const tracks = await playerCaptionTracks(videoId, session.url);
      const transcript = await fetchTimedText(pickTrack(tracks), session.url);
      trace.push(`  attempt ${attempt}  ${stamp}  new session ${session.sessionId} → ok`);
      return transcript;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      trace.push(`  attempt ${attempt}  ${stamp}  new session ${session.sessionId} → ${lastError}`);
      // A video with no captions won't grow one on retry.
      if (/no caption tracks|no transcript/.test(lastError)) break;
    }
  }
  throw new TranscriptError(
    [`TranscriptError: ${lastError}`, ...trace, `  giving up after ${trace.length} attempt${trace.length === 1 ? "" : "s"}`].join("\n"),
    trace,
  );
}
