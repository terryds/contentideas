import { getSetting } from "../db/db";
import { runClaude } from "./claude";

export interface Verdict {
  matched: boolean;
  reason: string;
  /** M7: canonical story slugs for cross-source clustering. Best-effort — may be empty. */
  topics: string[];
}

// The output contract lives here in code; the taste lives in the settings prompt.
// The TOPICS line rides on the same call so clustering costs no extra claude -p runs.
const CONTRACT =
  "Respond with EXACTLY two lines and nothing else:\n" +
  "Line 1, one of these two forms:\n" +
  "MATCH: <one line explaining why this fits>\n" +
  "SKIP: <one line explaining why not>\n" +
  "Line 2:\n" +
  "TOPICS: <2-4 kebab-case slugs, comma-separated>\n" +
  "Topic slugs identify THE SPECIFIC STORY so the same story from another source " +
  "gets the same slugs: use the most canonical name for the event plus its key " +
  "entities (e.g. TOPICS: gpt-6-release, openai). Lowercase, hyphenated, no spaces.";

const MAX_TOPICS = 4;

function parseTopics(output: string): string[] {
  const line = output.match(/^\s*TOPICS\s*[:—–-]\s*(.+)$/im)?.[1];
  if (!line) return [];
  return [...new Set(
    line
      .split(",")
      .map((slug) => slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
      .filter((slug) => slug.length > 1),
  )].slice(0, MAX_TOPICS);
}

export function parseVerdict(output: string): Verdict {
  const match = output.match(/^\s*(MATCH|SKIP)\s*[:—–-]?\s*(.*)$/im);
  if (!match) throw new Error(`Filter output had no MATCH/SKIP verdict: "${output.slice(0, 120)}"`);
  return {
    matched: match[1].toUpperCase() === "MATCH",
    reason: match[2].trim() || (match[1].toUpperCase() === "MATCH" ? "matched" : "skipped"),
    // A missing TOPICS line never fails the verdict — clustering is best-effort.
    topics: parseTopics(output),
  };
}

export async function filterEntry(entry: {
  title: string;
  source_label: string;
  content: string | null;
}): Promise<Verdict> {
  const taste = getSetting("taste_prompt") ?? "";
  const prompt = [
    "You are a personal content filter. Judge ONE entry against the owner's taste.",
    "",
    "## Owner's taste",
    taste,
    "",
    "## Entry",
    `Title: ${entry.title}`,
    `Source: ${entry.source_label}`,
    `Content: ${(entry.content ?? "").slice(0, 4000) || "(no summary available)"}`,
    "",
    "## Output format",
    CONTRACT,
  ].join("\n");
  return runClaude(prompt, parseVerdict, { timeoutMs: 60_000 });
}
