import { getSetting } from "../db/db";
import { runClaude } from "./claude";

export interface Verdict {
  matched: boolean;
  reason: string;
}

// The output contract lives here in code; the taste lives in the settings prompt.
const CONTRACT =
  "Respond with EXACTLY one line and nothing else, in one of these two forms:\n" +
  "MATCH: <one line explaining why this fits>\n" +
  "SKIP: <one line explaining why not>";

function parseVerdict(output: string): Verdict {
  const match = output.match(/^\s*(MATCH|SKIP)\s*[:—–-]?\s*(.*)$/im);
  if (!match) throw new Error(`Filter output had no MATCH/SKIP verdict: "${output.slice(0, 120)}"`);
  return {
    matched: match[1].toUpperCase() === "MATCH",
    reason: match[2].trim() || (match[1].toUpperCase() === "MATCH" ? "matched" : "skipped"),
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
