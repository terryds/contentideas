import { db, getSetting } from "../db/db";
import { runClaude } from "./claude";

// Transcript truncation: keep the beginning plus a middle sample (~15k words
// total — the claude CLI context is large; threshold picked per spec's open
// question, tune by trial).
const MAX_TRANSCRIPT_WORDS = 15_000;

export function truncateTranscript(transcript: string, maxWords: number = MAX_TRANSCRIPT_WORDS): string {
  const words = transcript.split(/\s+/);
  if (words.length <= maxWords) return transcript;
  const headLen = Math.floor(maxWords * (2 / 3));
  const middleLen = maxWords - headLen;
  const head = words.slice(0, headLen).join(" ");
  const middleStart = Math.floor(words.length / 2);
  const middle = words.slice(middleStart, middleStart + middleLen).join(" ");
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

export function parseThread(output: string): string[] {
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

interface GenerationInput {
  title: string;
  url: string | null;
  content: string | null;
  transcript: string | null;
  source_label: string;
}

/** Exposed separately so the exact `claude -p` input is inspectable/testable. */
export function composeGenerationPrompt(entry: GenerationInput): { prompt: string; voiceCount: number } {
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

  return { prompt: sections.filter((s) => s !== "").join("\n"), voiceCount: examples.length };
}

export async function generateThread(entry: GenerationInput): Promise<GeneratedThread> {
  const { prompt, voiceCount } = composeGenerationPrompt(entry);
  const tweets = await runClaude(prompt, parseThread, { timeoutMs: 120_000 });
  return { tweets, voiceCount };
}

/* ---------- M7: draft from a whole trending cluster ---------- */

/** One thread about one story, drawing on every source's take. Transcript budget is split across members. */
export function composeClusterGenerationPrompt(members: GenerationInput[]): { prompt: string; voiceCount: number } {
  const generationPrompt = getSetting("generation_prompt") ?? "";
  const examples = voiceExamples();
  const transcriptCount = Math.max(1, members.filter((m) => m.transcript).length);
  const perTranscript = Math.floor(15_000 / transcriptCount);

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
    `## Story to write about — trending across ${members.length} of the owner's sources`,
    "Write ONE thread about the story itself, drawing on all the takes below (the cross-source angle is part of what makes it thread-worthy).",
  );

  members.forEach((member, i) => {
    sections.push(
      "",
      `### Take ${i + 1} — ${member.source_label}`,
      `Title: ${member.title}`,
      member.url ? `URL: ${member.url}` : "",
      `Content: ${(member.content ?? "").slice(0, 4000) || "(no summary)"}`,
    );
    if (member.transcript) {
      sections.push("Transcript:", truncateTranscript(member.transcript, perTranscript));
    }
  });

  sections.push(
    "",
    "## Output format",
    "Return ONLY a JSON array of tweet strings — 3 to 6 tweets, one string per tweet.",
    'Example shape: ["first tweet", "second tweet", "third tweet"]',
    "No markdown, no commentary, no numbering inside the tweets.",
  );

  return { prompt: sections.filter((s) => s !== "").join("\n"), voiceCount: examples.length };
}

export async function generateClusterThread(members: GenerationInput[]): Promise<GeneratedThread> {
  const { prompt, voiceCount } = composeClusterGenerationPrompt(members);
  const tweets = await runClaude(prompt, parseThread, { timeoutMs: 120_000 });
  return { tweets, voiceCount };
}
