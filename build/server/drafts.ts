// Thread drafting — the ONE place drafts are generated, shared by the
// dashboard routes (Draft/Regenerate buttons) and the auto-draft pass that
// runs at the end of each cron run (2026-08-20).

import { appendRunError, db, getSetting, nowIso } from "./db/db";
import { generateClusterThread, generateThread } from "./llm/generator";
import { tagVocabulary } from "./llm/filter";
import { activeClusters } from "./trending/cluster";
import { sendDraftDigest } from "./notify/telegram";

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

export async function autoDraftPass(runId: number): Promise<void> {
  const drafted: { title: string; url: string | null; firstTweet: string }[] = [];

  if ((getSetting("auto_draft_trending") ?? "1") === "1") {
    for (const cluster of activeClusters()) {
      if (cluster.thread_id != null || cluster.dismissed_at) continue;
      try {
        const result = await draftClusterThread(cluster.id);
        drafted.push({
          title: cluster.title,
          url: draftPageUrl("cluster", cluster.id) ?? cluster.members.find((m) => m.url)?.url ?? null,
          firstTweet: result.tweets[0] ?? "",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[auto-draft] cluster ${cluster.id}: ${message}`);
        appendRunError(runId, `Auto-draft failed for trending "${cluster.title.slice(0, 60)}": ${message}`);
      }
    }
  }

  const selectedTags = autoDraftTags();
  if (selectedTags.length > 0) {
    const candidates = (
      db
        .prepare(
          `SELECT e.* FROM entries e
           WHERE e.filtered_run_id = ? AND e.filter_status = 'matched'
             AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.entry_id = e.id)
             AND EXISTS (SELECT 1 FROM json_each(COALESCE(e.tags, '[]')) WHERE json_each.value IN (${selectedTags.map(() => "?").join(",")}))
           ORDER BY e.id`,
        )
        .all(runId, ...selectedTags) as DraftableEntry[]
    );
    for (const entry of candidates) {
      try {
        const result = await draftEntryThread(entry);
        drafted.push({
          title: entry.title,
          url: draftPageUrl("item", entry.id) ?? entry.url,
          firstTweet: result.tweets[0] ?? "",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[auto-draft] entry ${entry.id}: ${message}`);
        appendRunError(runId, `Auto-draft failed for "${entry.title.slice(0, 60)}": ${message}`);
      }
    }
  }

  if (drafted.length > 0) {
    try {
      await sendDraftDigest(drafted);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[auto-draft] digest: ${message}`);
      appendRunError(runId, `Draft digest send failed (${drafted.length} draft${drafted.length === 1 ? "" : "s"} still available in the dashboard): ${message}`);
    }
  }
}
