// Thread drafting — the ONE place drafts are generated, shared by the
// dashboard routes (Draft/Regenerate buttons) and the auto-draft pass that
// runs at the end of each cron run (2026-08-20).

import { appendRunError, db, getSetting, nowIso } from "./db/db";
import { generateClusterThread, generateThread } from "./llm/generator";
import { tagVocabulary } from "./llm/filter";
import { activeClusters } from "./trending/cluster";
import { sendDraftDigest } from "./notify/telegram";
import { rankCandidates, type RankCandidate, type RankPick } from "./llm/ranker";

export interface DraftableEntry {
  id: number;
  title: string;
  url: string | null;
  content: string | null;
  transcript: string | null;
  source_label: string;
  source_type: string;
  state: string;
}

export interface DraftResult {
  threadId: number;
  tweets: string[];
  voiceCount: number;
}

/** YouTube entries missing a transcript get one retry before generation. */
async function ensureTranscript(entry: DraftableEntry): Promise<void> {
  if (entry.source_type !== "youtube" || entry.transcript) return;
  try {
    const { fetchTranscriptForEntry } = await import("./fetchers/transcript");
    const transcript = await fetchTranscriptForEntry(entry as never);
    if (transcript) {
      db.prepare("UPDATE entries SET transcript = ? WHERE id = ?").run(transcript, entry.id);
      entry.transcript = transcript;
    }
  } catch (err) {
    console.error(`[transcript] entry ${entry.id}:`, err);
    // Generation proceeds on title+content; the editor shows transcript status.
  }
}

/** Replace-or-create AFTER a successful generation — a failed regenerate never loses the previous draft. */
function upsertThread(column: "entry_id" | "cluster_id", subjectId: number, tweets: string[]): number {
  const existing = db.prepare(`SELECT id FROM threads WHERE ${column} = ?`).get(subjectId) as { id: number } | null;
  if (existing) {
    db.prepare("UPDATE threads SET draft_json = ?, updated_at = ? WHERE id = ?").run(
      JSON.stringify(tweets), nowIso(), existing.id,
    );
    return existing.id;
  }
  return db
    .prepare(`INSERT INTO threads (${column}, draft_json, updated_at) VALUES (?, ?, ?)`)
    .run(subjectId, JSON.stringify(tweets), nowIso()).lastInsertRowid as number;
}

export async function draftEntryThread(entry: DraftableEntry): Promise<DraftResult> {
  await ensureTranscript(entry);
  const generated = await generateThread(entry);
  const threadId = upsertThread("entry_id", entry.id, generated.tweets);
  if (entry.state !== "posted") {
    db.prepare("UPDATE entries SET state = 'drafted' WHERE id = ?").run(entry.id);
  }
  return { threadId, tweets: generated.tweets, voiceCount: generated.voiceCount };
}

export function fullClusterMembers(clusterId: number): DraftableEntry[] {
  return db
    .prepare(
      `SELECT e.id, e.title, e.url, e.content, e.transcript, e.source_label, e.source_type,
              e.filter_status, e.filter_reason, e.state
       FROM cluster_entries ce JOIN entries e ON e.id = ce.entry_id
       WHERE ce.cluster_id = ? ORDER BY e.id`,
    )
    .all(clusterId) as (DraftableEntry & { filter_status: string; filter_reason: string | null })[];
}

export async function draftClusterThread(clusterId: number): Promise<DraftResult> {
  const members = fullClusterMembers(clusterId);
  if (members.length === 0) throw new Error("Cluster has no member entries");
  for (const member of members) await ensureTranscript(member);
  const generated = await generateClusterThread(members);
  const threadId = upsertThread("cluster_id", clusterId, generated.tweets);
  return { threadId, tweets: generated.tweets, voiceCount: generated.voiceCount };
}

/** Owner's tag selection for auto-drafting, kept within the current vocabulary. */
export function autoDraftTags(): string[] {
  const vocabulary = tagVocabulary();
  const selected = (getSetting("auto_draft_tags") ?? "")
    .split(",")
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);
  return [...new Set(selected)].filter((tag) => vocabulary.includes(tag));
}

/**
 * End-of-run auto-drafting: trending clusters (setting on by default) and
 * newly-judged entries carrying a selected tag. Each subject is attempted once
 * per run; a subject with an existing thread is permanently skipped. Failures
 * degrade the run, never fail it. Finishes with ONE draft digest to Telegram
 * (informational — a failed send is recorded but not retried).
 */
/** Deep link into the dashboard's editor — when the owner has told us how they reach it. */
export function draftPageUrl(kind: "item" | "cluster", id: number): string | null {
  const base = (getSetting("dashboard_url") ?? "").trim().replace(/\/+$/, "");
  return base ? `${base}/${kind}/${id}` : null;
}

interface Candidate extends RankCandidate {
  kind: "entry" | "cluster";
  id: number;
  fallbackUrl: string | null;
}

function collectClusterCandidates(): Candidate[] {
  const candidates: Candidate[] = [];
  if ((getSetting("auto_draft_trending") ?? "1") !== "1") return candidates;
  for (const cluster of activeClusters()) {
    if (cluster.thread_id != null || cluster.dismissed_at) continue;
    const memberScores = (
      db
        .prepare(
          `SELECT MAX(e.score) AS best FROM cluster_entries ce JOIN entries e ON e.id = ce.entry_id WHERE ce.cluster_id = ?`,
        )
        .get(cluster.id) as { best: number | null }
    ).best;
    candidates.push({
      key: `cluster:${cluster.id}`,
      kind: "cluster",
      id: cluster.id,
      title: cluster.title,
      source: [...new Set(cluster.members.map((m) => m.source_label))].join(", "),
      reason: null,
      // Cross-source corroboration bonus: a story in several places outranks its best member.
      score: memberScores != null ? Math.min(10, memberScores + 1) : null,
      tags: [],
      sourcesCount: cluster.sources_count,
      fallbackUrl: cluster.members.find((m) => m.url)?.url ?? null,
    });
  }
  return candidates;
}

function collectTagCandidates(runId: number): Candidate[] {
  const selectedTags = autoDraftTags();
  if (selectedTags.length === 0) return [];
  const rows = db
    .prepare(
      `SELECT e.* FROM entries e
       WHERE e.filtered_run_id = ? AND e.filter_status = 'matched'
         AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.entry_id = e.id)
         AND EXISTS (SELECT 1 FROM json_each(COALESCE(e.tags, '[]')) WHERE json_each.value IN (${selectedTags.map(() => "?").join(",")}))
       ORDER BY e.id`,
    )
    .all(runId, ...selectedTags) as (DraftableEntry & {
    filter_reason: string | null;
    score: number | null;
    tags: string | null;
    source_label: string;
  })[];
  return rows.map((entry) => ({
    key: `entry:${entry.id}`,
    kind: "entry" as const,
    id: entry.id,
    title: entry.title,
    source: entry.source_label,
    reason: entry.filter_reason,
    score: entry.score,
    tags: entry.tags ? (JSON.parse(entry.tags) as string[]) : [],
    fallbackUrl: entry.url,
  }));
}

/**
 * Per-run auto-drafting (tag-triggered): entries judged this run carrying a
 * selected tag, ranked comparatively, capped. Trending clusters are drafted by
 * the DAILY trending job instead (autoDraftTrendingPass) — separate rhythm.
 */
export async function autoDraftPass(runId: number): Promise<void> {
  await rankAndDraft(collectTagCandidates(runId), runId);
}

/** The daily trending job's drafting half: cluster candidates only. */
export async function autoDraftTrendingPass(runId: number): Promise<void> {
  await rankAndDraft(collectClusterCandidates(), runId);
}

/**
 * Two-stage ranking + cap (anti-overwhelm, 2026-08-20): ONE comparative ranking
 * call picks at most `max_auto_drafts` (fewer/zero allowed), drafts best-first,
 * sends one shortlist digest. Ranker failure falls back to stage-1 score order.
 * Unpicked candidates stay in the Inbox.
 */
async function rankAndDraft(candidates: Candidate[], runId: number): Promise<void> {
  if (candidates.length === 0) return;

  const capRaw = Number(getSetting("max_auto_drafts") ?? "3");
  const maxPicks = Number.isInteger(capRaw) && capRaw >= 1 && capRaw <= 10 ? capRaw : 3;

  let picks: RankPick[];
  if (candidates.length === 1) {
    picks = [{ key: candidates[0].key, why: "" }]; // nothing to compare against
  } else {
    try {
      picks = await rankCandidates(candidates, maxPicks);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-draft] ranker: ${message}`);
      appendRunError(runId, `Draft ranking failed (falling back to score order): ${message}`);
      picks = [...candidates]
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.id - a.id)
        .slice(0, maxPicks)
        .map((c) => ({ key: c.key, why: "" }));
    }
  }

  const drafted: { title: string; url: string | null; firstTweet: string; why?: string }[] = [];
  for (const pick of picks) {
    const candidate = candidates.find((c) => c.key === pick.key);
    if (!candidate) continue;
    try {
      const result =
        candidate.kind === "cluster"
          ? await draftClusterThread(candidate.id)
          : await draftEntryThread(
              db.prepare("SELECT * FROM entries WHERE id = ?").get(candidate.id) as DraftableEntry,
            );
      drafted.push({
        title: candidate.title,
        url: draftPageUrl(candidate.kind === "cluster" ? "cluster" : "item", candidate.id) ?? candidate.fallbackUrl,
        firstTweet: result.tweets[0] ?? "",
        why: pick.why || undefined,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-draft] ${candidate.key}: ${message}`);
      appendRunError(runId, `Auto-draft failed for "${candidate.title.slice(0, 60)}": ${message}`);
    }
  }

  if (drafted.length > 0) {
    try {
      await sendDraftDigest(drafted, candidates.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-draft] digest: ${message}`);
      appendRunError(runId, `Draft digest send failed (${drafted.length} draft${drafted.length === 1 ? "" : "s"} still available in the dashboard): ${message}`);
    }
  }
}
