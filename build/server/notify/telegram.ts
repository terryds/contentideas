import { getSetting } from "../db/db";

// Messages are sent as plain text (no parse_mode) so titles never need
// markdown escaping; Telegram's chrome wins there.
async function send(text: string): Promise<void> {
  const token = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");
  if (!token || !chatId) {
    throw new Error("Telegram not configured — add the bot token and chat ID in Settings");
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
  if (!res.ok || !body?.ok) {
    throw new Error(`Telegram API error: ${body?.description ?? `HTTP ${res.status}`}`);
  }
}

export async function sendMatch(entry: {
  title: string;
  source_label: string;
  filter_reason: string | null;
  url: string | null;
}): Promise<void> {
  const lines = [
    entry.title,
    `via ${entry.source_label}`,
    entry.filter_reason ? `Filter's take: ${entry.filter_reason}` : null,
    entry.url,
  ].filter(Boolean);
  await send(lines.join("\n\n"));
}

// M7: one ping per cluster, when it first spans the source threshold.
export async function sendTrending(cluster: {
  title: string;
  sourceLabels: string[];
  links: { label: string; url: string }[];
}): Promise<void> {
  const lines = [
    "📈 Trending in your sources",
    cluster.title,
    `Seen in: ${cluster.sourceLabels.join(", ")}`,
    ...cluster.links.slice(0, 5).map((link) => `${link.label}: ${link.url}`),
  ];
  await send(lines.join("\n\n"));
}

export async function sendTest(): Promise<void> {
  await send("Content Engine test — it works");
}
