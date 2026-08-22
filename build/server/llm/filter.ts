import { getSetting } from "../db/db";
import { runClaude } from "./claude";

export interface Verdict {
  matched: boolean;
  reason: string;
  /** M7: canonical story slugs for cross-source clustering. Best-effort — may be empty. */
  topics: string[];
  /** Tags from the owner's vocabulary (Settings). Best-effort — may be empty. */
  tags: string[];
}

// The output contract lives here in code; the taste lives in the settings prompt.
// The TOPICS and TAGS lines ride on the same call, so clustering and
// classification cost no extra claude -p runs.
function contract(vocabulary: string[]): string {
  const lines = [
    `Respond with EXACTLY ${vocabulary.length > 0 ? "three" : "two"} lines and nothing else:`,
    "Line 1, one of these two forms:",
    "MATCH: <one line explaining why this fits>",
    "SKIP: <one line explaining why not>",
    "Line 2:",
    "TOPICS: <2-4 kebab-case slugs, comma-separated>",
    "Topic slugs identify THE SPECIFIC STORY so the same story from another source " +
      "gets the same slugs: use the most canonical name for the event plus its key " +
      "entities (e.g. TOPICS: gpt-6-release, openai). Lowercase, hyphenated, no spaces.",
  ];
  if (vocabulary.length > 0) {
    lines.push(
      "Line 3:",
      "TAGS: <zero or more tags, comma-separated, chosen STRICTLY from this list (or the word none)>",
      `Allowed tags: ${vocabulary.join(", ")}`,
      "Apply every tag that fits the entry; invent nothing outside the list.",
    );
  }
  return lines.join("\n");
}

const MAX_TOPICS = 4;

/** The owner's tag vocabulary from Settings — normalized, deduped. */
export function tagVocabulary(): string[] {
  const raw = getSetting("tags") ?? "";
  return [...new Set(
    raw
      .split(",")
      .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
      .filter(Boolean),
  )];
}

function parseSlugLine(output: string, label: string): string[] {
  const line = output.match(new RegExp(`^\\s*${label}\\s*[:—–-]\\s*(.+)$`, "im"))?.[1];
  if (!line) return [];
  return [...new Set(
    line
      .split(",")
      .map((slug) => slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""))
      .filter((slug) => slug.length > 1),
  )];
}

/** Keep only tags from the vocabulary — the model never gets to invent labels. */
export function sanitizeTags(raw: string[], vocabulary: string[]): string[] {
  return raw.filter((tag) => vocabulary.includes(tag));
}

export function parseVerdict(output: string, vocabulary: string[] = []): Verdict {
  const match = output.match(/^\s*(MATCH|SKIP)\s*[:—–-]?\s*(.*)$/im);
  if (!match) throw new Error(`Filter output had no MATCH/SKIP verdict: "${output.slice(0, 120)}"`);
  return {
    matched: match[1].toUpperCase() === "MATCH",
    reason: match[2].trim() || (match[1].toUpperCase() === "MATCH" ? "matched" : "skipped"),
    // Missing TOPICS/TAGS lines never fail the verdict — both are best-effort.
    topics: parseSlugLine(output, "TOPICS").slice(0, MAX_TOPICS),
    tags: sanitizeTags(parseSlugLine(output, "TAGS"), vocabulary),
  };
}

export async function filterEntry(entry: {
  title: string;
  source_label: string;
  content: string | null;
}): Promise<Verdict> {
  const taste = getSetting("taste_prompt") ?? "";
  const vocabulary = tagVocabulary();
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
    contract(vocabulary),
  ].join("\n");
  return runClaude(prompt, (output) => parseVerdict(output, vocabulary), { timeoutMs: 60_000 });
}
