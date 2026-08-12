import { db, getSetting } from "../db/db";
import { runClaude } from "./claude";

// Transcript truncation: keep the beginning plus a middle sample (~15k words
// total — the claude CLI context is large; threshold picked per spec's open
// question, tune by trial).
const MAX_TRANSCRIPT_WORDS = 15_000;

export function truncateTranscript(transcript: string): string {
  const words = transcript.split(/\s+/);
  if (words.length <= MAX_TRANSCRIPT_WORDS) return transcript;
  const head = words.slice(0, 10_000).join(" ");
  const middleStart = Math.floor(words.length / 2);
  const middle = words.slice(middleStart, middleStart + 5_000).join(" ");
  return `${head}\n\n[… transcript truncated (${words.length} words total) — middle sample follows …]\n\n${middle}`;
}

export function voiceExamples(): string[] {
  const count = Number(getSetting("voice_examples_count") ?? "5");
  const rows = db
    .prepare(
      "SELECT final_text FROM threads WHERE final_text IS NOT NULL AND posted_at IS NOT NULL ORDER BY posted_at DESC LIMIT ?",
    )
    .all(count) as { final_text: string }[];
  return rows.map((r) => r.final_text);
}

function parseThread(output: string): string[] {
  // Models love code fences; strip them before parsing.
  const cleaned = output.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/m, "").trim();
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Generator output was not a JSON array: "${output.slice(0, 120)}"`);
  }
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((t) => typeof t === "string" && t.trim())) {
    throw new Error("Generator returned an empty or non-string array");
  }
  return (parsed as string[]).map((t) => t.trim()).slice(0, 10);
}

export interface GeneratedThread {
  tweets: string[];
  voiceCount: number;
}

export async function generateThread(entry: {
  title: string;
  url: string | null;
  content: string | null;
  transcript: string | null;
  source_label: string;
}): Promise<GeneratedThread> {
  const generationPrompt = getSetting("generation_prompt") ?? "";
  const examples = voiceExamples();

  const sections = [
    "You write Twitter threads for the owner of this tool. Follow their instructions exactly.",
    "",
    "## Owner's instructions",
    generationPrompt,
  ];

  if (examples.length > 0) {
    sections.push(
      "",
      "## Voice examples — the owner's last posted threads, most recent first. Match their voice, rhythm, and formatting.",
      ...examples.map((example, i) => `### Example ${i + 1}\n${example}`),
    );
  }

  sections.push(
    "",
    "## Item to write about",
    `Title: ${entry.title}`,
    `Source: ${entry.source_label}`,
    entry.url ? `URL: ${entry.url}` : "",
    `Content: ${(entry.content ?? "").slice(0, 6000) || "(no summary)"}`,
  );

  if (entry.transcript) {
    sections.push("", "## Video transcript", truncateTranscript(entry.transcript));
  }

  sections.push(
    "",
    "## Output format",
    "Return ONLY a JSON array of tweet strings — 3 to 6 tweets, one string per tweet.",
    'Example shape: ["first tweet", "second tweet", "third tweet"]',
    "No markdown, no commentary, no numbering inside the tweets.",
  );

  const tweets = await runClaude(sections.filter((s) => s !== "").join("\n"), parseThread, {
    timeoutMs: 120_000,
  });
  return { tweets, voiceCount: examples.length };
}
