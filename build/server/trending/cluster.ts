// M7 cross-source trending. Two-tier story identity: exact normalized-URL match,
// or ≥2 overlapping topic slugs (from the filter's claude -p call). One Telegram
// ping per cluster when it first spans the threshold of distinct sources —
// regardless of the members' taste verdicts.

import { appendRunError, db, getSetting, nowIso } from "../db/db";
import { sendTrending } from "../notify/telegram";

export const CLUSTER_WINDOW_MS = 48 * 60 * 60 * 1000; // spec: code constant, not a setting
const MIN_TOPIC_OVERLAP = 2;
const MAX_CLUSTER_SLUGS = 8; // stop absorbing past this — prevents mega-cluster drift
const MAX_CLUSTER_URLS = 16;

/* ---------- URL normalization ---------- */

const TRACKING_PARAM = /^(utm_.*|ref|fbclid|gclid|si)$/;

/** Stable identity for "the same page": host+path+meaningful query. Null when unparseable. */
export function normalizeUrlKey(rawUrl: string | null): string | null {
  if (!rawUrl) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const params = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key.toLowerCase()));
  params.sort(([a], [b]) => a.localeCompare(b));
  const query = params.length ? `?${params.map(([k, v]) => `${k}=${v}`).join("&")}` : "";
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${host}${path}${query}`;
}

/* ---------- clustering ---------- */

export interface ClusterRow {
  id: number;
  title: string;
  slugs: string; // JSON string[]
  url_keys: string; // JSON string[]
  first_seen: string;
  last_activity: string;
  notified_at: string | null;
  dismissed_at: string | null;
}

interface Clusterable {
  id: number;
  source_id: number;
  title: string;
  url_key: string | null;
  topics: string | null; // JSON string[]
}

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function windowCutoff(): string {
  return new Date(Date.now() - CLUSTER_WINDOW_MS).toISOString();
}

function assignToCluster(entry: Clusterable): void {
  const topics = parseList(entry.topics);
  const candidates = db
    .prepare("SELECT * FROM clusters WHERE last_activity >= ? ORDER BY last_activity DESC")
    .all(windowCutoff()) as ClusterRow[];

  for (const cluster of candidates) {
    const urlKeys = parseList(cluster.url_keys);
    const slugs = parseList(cluster.slugs);
    const urlHit = entry.url_key !== null && urlKeys.includes(entry.url_key);
    const overlap = topics.filter((t) => slugs.includes(t)).length;
    if (!urlHit && overlap < MIN_TOPIC_OVERLAP) continue;

    const nextSlugs = [...slugs];
    for (const t of topics) if (!nextSlugs.includes(t) && nextSlugs.length < MAX_CLUSTER_SLUGS) nextSlugs.push(t);
    const nextUrls = [...urlKeys];
    if (entry.url_key && !nextUrls.includes(entry.url_key) && nextUrls.length < MAX_CLUSTER_URLS) nextUrls.push(entry.url_key);

    db.transaction(() => {
      db.prepare("INSERT OR IGNORE INTO cluster_entries (cluster_id, entry_id) VALUES (?, ?)").run(cluster.id, entry.id);
      db.prepare("UPDATE clusters SET slugs = ?, url_keys = ?, last_activity = ? WHERE id = ?").run(
        JSON.stringify(nextSlugs), JSON.stringify(nextUrls), nowIso(), cluster.id,
      );
    })();
    return;
  }

  // No match — this entry seeds a new cluster (most clusters stay single-member
  // and never notify; they exist so the NEXT source's take has something to join).
  db.transaction(() => {
    const clusterId = db
      .prepare("INSERT INTO clusters (title, slugs, url_keys, first_seen, last_activity) VALUES (?, ?, ?, ?, ?)")
      .run(entry.title, JSON.stringify(topics), JSON.stringify(entry.url_key ? [entry.url_key] : []), nowIso(), nowIso())
      .lastInsertRowid as number;
    db.prepare("INSERT INTO cluster_entries (cluster_id, entry_id) VALUES (?, ?)").run(clusterId, entry.id);
  })();
}

export function trendingThreshold(): number {
  const raw = Number(getSetting("trending_threshold") ?? "2");
  return Number.isInteger(raw) && raw >= 2 ? raw : 2;
}

export function distinctSourceCount(clusterId: number): number {
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT e.source_id) AS n
         FROM cluster_entries ce JOIN entries e ON e.id = ce.entry_id
         WHERE ce.cluster_id = ?`,
      )
      .get(clusterId) as { n: number }
  ).n;
}

export interface ClusterMember {
  id: number;
  title: string;
  url: string | null;
  source_label: string;
  source_type: string;
  filter_status: string;
  state: string;
}

export function clusterMembers(clusterId: number): ClusterMember[] {
  return db
    .prepare(
      `SELECT e.id, e.title, e.url, e.source_label, e.source_type, e.filter_status, e.state
       FROM cluster_entries ce JOIN entries e ON e.id = ce.entry_id
       WHERE ce.cluster_id = ? ORDER BY e.id`,
    )
    .all(clusterId) as ClusterMember[];
}

/** Clusters the Inbox shows: active in the window, not dismissed, at/above threshold. */
export function activeClusters(): (ClusterRow & { sources_count: number; members: ClusterMember[]; thread_id: number | null })[] {
  const rows = db
    .prepare("SELECT * FROM clusters WHERE dismissed_at IS NULL AND last_activity >= ? ORDER BY last_activity DESC")
    .all(windowCutoff()) as ClusterRow[];
  const threshold = trendingThreshold();
  return rows
    .map((cluster) => ({
      ...cluster,
      sources_count: distinctSourceCount(cluster.id),
      members: clusterMembers(cluster.id),
      thread_id:
        (db.prepare("SELECT id FROM threads WHERE cluster_id = ? ORDER BY id DESC LIMIT 1").get(cluster.id) as
          | { id: number }
          | null)?.id ?? null,
    }))
    .filter((cluster) => cluster.sources_count >= threshold);
}

/**
 * Run-pipeline step: cluster every newly filtered entry, then notify clusters
 * that just crossed the source threshold. Notify-once: `notified_at` is stamped
 * only after a successful send. Clustering failures degrade the run, never fail it.
 */
export async function trendingPass(runId: number): Promise<void> {
  try {
    const fresh = db
      .prepare(
        `SELECT id, source_id, title, url_key, topics FROM entries
         WHERE filtered_at IS NOT NULL
           AND COALESCE(filter_reason, '') != 'initial import'
           AND created_at >= ?
           AND (url_key IS NOT NULL OR (topics IS NOT NULL AND topics != '[]'))
           AND id NOT IN (SELECT entry_id FROM cluster_entries)
         ORDER BY id`,
      )
      .all(windowCutoff()) as Clusterable[];
    for (const entry of fresh) assignToCluster(entry);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[trending] clustering failed:", err);
    appendRunError(runId, `Trending clustering failed: ${message}. Entries will be re-clustered next run.`);
    return;
  }

  const threshold = trendingThreshold();
  const due = (
    db
      .prepare(
        "SELECT * FROM clusters WHERE notified_at IS NULL AND dismissed_at IS NULL AND last_activity >= ?",
      )
      .all(windowCutoff()) as ClusterRow[]
  ).filter((cluster) => distinctSourceCount(cluster.id) >= threshold);

  for (const cluster of due) {
    const members = clusterMembers(cluster.id);
    try {
      await sendTrending({
        title: cluster.title,
        sourceLabels: [...new Set(members.map((m) => m.source_label))],
        links: members.filter((m) => m.url).map((m) => ({ label: m.source_label, url: m.url as string })),
      });
      db.prepare("UPDATE clusters SET notified_at = ? WHERE id = ?").run(nowIso(), cluster.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[trending] cluster ${cluster.id}: ${message}`);
      appendRunError(runId, `Trending Telegram send failed for "${cluster.title.slice(0, 60)}": ${message}`);
      if (/not configured/i.test(message)) return; // no creds — every send would fail
    }
  }
}
