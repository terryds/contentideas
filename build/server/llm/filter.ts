import { getSetting } from "../db/db";
import { runClaudeStructured } from "./claude";

export interface Verdict {
  matched: boolean;
  reason: string;
  /** M7: canonical story slugs for cross-source clustering. Best-effort — may be empty. */
  topics: string[];
  /** Tags from the owner's vocabulary (Settings). Best-effort — may be empty. */
  tags: string[];
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

// Verdict shape enforced by the CLI itself (claude -p --json-schema): the model
// is forced through a schema-validated tool call, so no text parsing exists.
// The tag vocabulary rides in as an enum — off-list tags are impossible at the
// model level; normalizeVerdict below stays as belt-and-braces.
function verdictSchema(vocabulary: string[]): object {
  return {
    type: "object",
    properties: {
      matched: { type: "boolean" },
      reason: { type: "string", minLength: 1 },
      topics: { type: "array", items: { type: "string" }, minItems: 1, maxItems: MAX_TOPICS },
      tags:
        vocabulary.length > 0
          ? { type: "array", items: { type: "string", enum: vocabulary }, maxItems: vocabulary.length }
          : { type: "array", items: { type: "string" }, maxItems: 0 },
    },
    required: ["matched", "reason", "topics", "tags"],
  };
}

function sanitizeSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** Keep only tags from the vocabulary — the model never gets to invent labels. */
export function sanitizeTags(raw: string[], vocabulary: string[]): string[] {
  return [...new Set(raw.map(sanitizeSlug))].filter((tag) => vocabulary.includes(tag));
}

interface RawVerdict {
  matched?: unknown;
  reason?: unknown;
  topics?: unknown;
  tags?: unknown;
}

/** Normalize a schema-validated verdict object. Pure — exported for tests. */
export function normalizeVerdict(raw: RawVerdict, vocabulary: string[] = []): Verdict {
  if (typeof raw.matched !== "boolean") throw new Error("Filter output had no boolean `matched`");
  const topics = Array.isArray(raw.topics) ? raw.topics.filter((t): t is string => typeof t === "string") : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === "string") : [];
  return {
    matched: raw.matched,
    reason: (typeof raw.reason === "string" && raw.reason.trim()) || (raw.matched ? "matched" : "skipped"),
    topics: [...new Set(topics.map(sanitizeSlug))].filter((slug) => slug.length > 1).slice(0, MAX_TOPICS),
    tags: sanitizeTags(tags, vocabulary),
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
    "## Your judgment (structured)",
    "matched: does this entry fit the owner's taste?",
    "reason: ONE line explaining why it fits or why not.",
    "topics: 2-4 kebab-case slugs identifying THE SPECIFIC STORY, so the same story " +
      "from another source gets the same slugs — the most canonical name for the event " +
      "plus its key entities (e.g. gpt-6-release, openai).",
    vocabulary.length > 0
      ? `tags: every tag that fits the entry, chosen strictly from: ${vocabulary.join(", ")}. Empty array if none fit.`
      : "tags: always an empty array.",
  ].join("\n");
  const raw = await runClaudeStructured<RawVerdict>(prompt, verdictSchema(vocabulary), { timeoutMs: 60_000 });
  return normalizeVerdict(raw, vocabulary);
}
