import { getSetting } from "../db/db";

// Digest-style notifications (anti-spam, 2026-08-20): one message per run for
// all matches, one for all newly-trending clusters — never one per record.
// HTML formatting: bold headlines, source labels hyperlinked to the originals.

const MAX_BULLETS = 20; // past this the digest says "…and N more — see your Inbox"
const MAX_REASON = 200;
const MAX_MESSAGE = 3900; // Telegram cap is 4096; leave headroom

async function send(text: string, html: boolean): Promise<void> {
  const token = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");
  if (!token || !chatId) {
    throw new Error("Telegram not configured — add the bot token and chat ID in Settings");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(html ? { parse_mode: "HTML" } : {}),
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram API error: ${body?.description ?? `HTTP ${res.status}`}`);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(url: string): string {
  return escapeHtml(url).replace(/"/g, "&quot;");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Assemble a bulleted digest under Telegram's length cap; overflow becomes a count line. */
function assemble(header: string, bullets: string[], overflowNoun: string): string {
  const kept: string[] = [];
  let length = header.length;
  for (const bullet of bullets) {
    if (kept.length >= MAX_BULLETS || length + bullet.length + 2 > MAX_MESSAGE) break;
    kept.push(bullet);
    length += bullet.length + 2;
  }
  const overflow = bullets.length - kept.length;
  const parts = [header, ...kept];
  if (overflow > 0) parts.push(`…and ${overflow} more ${overflowNoun} — see your Inbox`);
  return parts.join("\n\n");
}

export interface MatchDigestEntry {
  title: string;
  source_label: string;
  filter_reason: string | null;
  url: string | null;
  tags?: string[] | null;
}

/** Pure composer — exported for tests. */
export function composeMatchDigest(entries: MatchDigestEntry[]): string {
  const header = `🔎 ${entries.length} new match${entries.length === 1 ? "" : "es"}`;
  const bullets = entries.map((entry) => {
    const source = entry.url
      ? `<a href="${escapeAttr(entry.url)}">${escapeHtml(entry.source_label)}</a>`
      : escapeHtml(entry.source_label);
    const reason = entry.filter_reason ? `\n${escapeHtml(clip(entry.filter_reason, MAX_REASON))}` : "";
    // Telegram hashtags only link word characters — hyphens become underscores.
    const tags = entry.tags?.length
      ? `\n${entry.tags.map((tag) => `#${tag.replace(/[^a-z0-9]+/gi, "_")}`).join(" ")}`
      : "";
    return `• <b>${escapeHtml(entry.title)}</b> — ${source}${reason}${tags}`;
  });
  return assemble(header, bullets, "matches");
}

export async function sendMatchDigest(entries: MatchDigestEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await send(composeMatchDigest(entries), true);
}

export interface TrendingDigestCluster {
  title: string;
  members: { label: string; url: string | null }[];
}

/** Pure composer — exported for tests. */
export function composeTrendingDigest(clusters: TrendingDigestCluster[]): string {
  const header = `📈 ${clusters.length} trending stor${clusters.length === 1 ? "y" : "ies"} in your sources`;
  const bullets = clusters.map((cluster) => {
    const seen = new Set<string>();
    const links = cluster.members
      .filter((m) => (seen.has(m.label) ? false : (seen.add(m.label), true)))
      .map((m) => (m.url ? `<a href="${escapeAttr(m.url)}">${escapeHtml(m.label)}</a>` : escapeHtml(m.label)))
      .join(" · ");
    return `• <b>${escapeHtml(cluster.title)}</b>\nseen in ${links}`;
  });
  return assemble(header, bullets, "stories");
}

export async function sendTrendingDigest(clusters: TrendingDigestCluster[]): Promise<void> {
  if (clusters.length === 0) return;
  await send(composeTrendingDigest(clusters), true);
}

export async function sendTest(): Promise<void> {
  await send("Content Engine test — it works", false);
}
