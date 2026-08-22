// Stage-2 comparative ranking for auto-draft candidates (2026-08-20): ONE
// structured claude -p call per run that sees every candidate side by side and
// picks at most N worth drafting today — picking fewer, or zero, is allowed.
// Isolated stage-1 scores can't be calibrated against each other; this can.

import { getSetting } from "../db/db";
import { runClaudeStructured } from "./claude";

export interface RankCandidate {
  /** Stable key, e.g. "entry:42" or "cluster:7". */
  key: string;
  title: string;
  source: string;
  reason: string | null;
  score: number | null;
  tags: string[];
  /** For clusters: how many distinct sources carry the story. */
  sourcesCount?: number;
}

export interface RankPick {
  key: string;
  why: string;
}

function rankSchema(keys: string[], maxPicks: number): object {
  return {
    type: "object",
    properties: {
      picks: {
        type: "array",
        maxItems: maxPicks,
        items: {
          type: "object",
          properties: {
            key: { type: "string", enum: keys },
            why: { type: "string", minLength: 1 },
          },
          required: ["key", "why"],
        },
      },
    },
    required: ["picks"],
  };
}

/** Drop unknown keys and duplicates, keep pick order, cap at maxPicks. Pure — exported for tests. */
export function sanitizePicks(raw: unknown, validKeys: string[], maxPicks: number): RankPick[] {
  const list = Array.isArray((raw as { picks?: unknown })?.picks) ? ((raw as { picks: unknown[] }).picks) : [];
  const seen = new Set<string>();
  const picks: RankPick[] = [];
  for (const item of list) {
    const pick = item as { key?: unknown; why?: unknown };
    if (typeof pick.key !== "string" || !validKeys.includes(pick.key) || seen.has(pick.key)) continue;
    seen.add(pick.key);
    picks.push({ key: pick.key, why: typeof pick.why === "string" ? pick.why.trim() : "" });
    if (picks.length >= maxPicks) break;
  }
  return picks;
}

export async function rankCandidates(candidates: RankCandidate[], maxPicks: number): Promise<RankPick[]> {
  const taste = getSetting("taste_prompt") ?? "";
  const lines = candidates.map((c) => {
    const bits = [
      `- key: "${c.key}"`,
      `  title: ${c.title}`,
      `  source: ${c.source}${c.sourcesCount && c.sourcesCount > 1 ? ` (trending — ${c.sourcesCount} sources carry this story)` : ""}`,
      c.reason ? `  filter's take: ${c.reason}` : "",
      c.score != null ? `  priority score: ${c.score}/10` : "",
      c.tags.length ? `  tags: ${c.tags.join(", ")}` : "",
    ];
    return bits.filter(Boolean).join("\n");
  });
  const prompt = [
    "You are the owner's chief content editor. Below are ALL of today's thread-draft candidates.",
    "Compare them AGAINST EACH OTHER and pick only what is genuinely worth the owner drafting a Twitter thread about today.",
    `Pick AT MOST ${maxPicks}. Picking fewer is good editing; picking zero is a valid answer when nothing stands out.`,
    "Order picks best-first. For each pick, give a ONE-line why (it is shown in the owner's notification).",
    "",
    "## Owner's taste",
    taste,
    "",
    "## Candidates",
    ...lines,
  ].join("\n");
  const raw = await runClaudeStructured<unknown>(prompt, rankSchema(candidates.map((c) => c.key), maxPicks), {
    timeoutMs: 90_000,
    model: "sonnet",
  });
  return sanitizePicks(raw, candidates.map((c) => c.key), maxPicks);
}
