// Typed fetch helpers for /api/*. Network failures (server not running) dispatch
// a window event the shell listens to for its global banner.

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...init,
    });
  } catch {
    window.dispatchEvent(new CustomEvent("api-unreachable"));
    throw new ApiError("Server not responding — is the process running?", 0);
  }
  window.dispatchEvent(new CustomEvent("api-reachable"));
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
  }
  return body as T;
}

export type SourceType = "youtube" | "twitter" | "hn" | "rss";

export interface Source {
  id: number;
  type: SourceType;
  handle_or_url: string;
  display_name: string;
  channel_id: string | null;
  active: number;
  created_at: string;
  check_interval: string;
  max_records: number;
  last_fetched_at: string | null;
  schedule_times: string | null;
  health_status: "ok" | "retrying" | "failed" | null;
  health_error: string | null;
  health_run_id: number | null;
  last_checked: string | null;
  new_7d: number;
  matched_7d: number;
}

export interface Entry {
  id: number;
  source_id: number;
  source_type: SourceType;
  source_label: string;
  external_id: string;
  title: string;
  url: string | null;
  content: string | null;
  transcript: string | null;
  filter_status: "pending" | "matched" | "skipped";
  filter_reason: string | null;
  filtered_at: string | null;
  state: "new" | "notified" | "drafted" | "posted" | "dismissed";
  created_at: string;
  tags: string | null; // JSON array of vocabulary tags
  score: number | null; // rubric priority 1-10 from the filter judgment
}

export function parseTags(tags: string | null | undefined): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export interface Thread {
  id: number;
  entry_id: number | null;
  cluster_id: number | null;
  draft_json: string;
  final_text: string | null;
  posted_at: string | null;
  updated_at: string;
}

export interface ClusterMember {
  id: number;
  title: string;
  url: string | null;
  content?: string | null;
  transcript?: string | null;
  source_label: string;
  source_type: SourceType;
  filter_status: "pending" | "matched" | "skipped";
  filter_reason?: string | null;
  state: Entry["state"];
}

export interface Cluster {
  id: number;
  title: string;
  first_seen: string;
  last_activity: string;
  notified_at: string | null;
  dismissed_at: string | null;
  sources_count: number;
  members: ClusterMember[];
  thread_id?: number | null;
}

export interface Run {
  id: number;
  trigger: "cron" | "manual";
  started_at: string;
  finished_at: string | null;
  new_count: number;
  matched_count: number;
  failed_count: number;
  error_text: string | null;
  sources_count?: number;
  filtered_count?: number;
}

export interface RunSource {
  id: number;
  run_id: number;
  source_id: number;
  source_label: string;
  new_count: number;
  matched_count: number;
  duration_ms: number;
  attempts: number;
  status: "ok" | "retrying" | "failed";
  error_text: string | null;
}

export interface DraftListItem {
  id: number;
  entry_id: number | null;
  cluster_id: number | null;
  draft_json: string;
  posted_at: string | null;
  updated_at: string;
  subject_title: string;
  source_label: string | null;
  url: string | null;
}

export interface RunEntry {
  id: number;
  source_label: string;
  title: string;
  url: string | null;
  filter_status: "pending" | "matched" | "skipped";
  filter_reason: string | null;
  state: Entry["state"];
  tags: string | null;
  score: number | null;
}

export interface SettingsPayload {
  values: Record<string, string | null>;
  secrets: Record<string, { set: boolean }>;
}

export const api = {
  listSources: () => request<{ sources: Source[] }>("/api/sources"),
  addSource: (type: SourceType, input: string, check_interval: string, max_records: number, schedule_times?: string) =>
    request<{ id: number; display_name: string }>("/api/sources", {
      method: "POST",
      body: JSON.stringify({ type, input, check_interval, max_records, schedule_times }),
    }),
  updateSource: (id: number, cadence: { check_interval?: string; max_records?: number; schedule_times?: string }) =>
    request<{ ok: true }>(`/api/sources/${id}`, { method: "PUT", body: JSON.stringify(cadence) }),
  pauseSource: (id: number) => request<{ ok: true }>(`/api/sources/${id}/pause`, { method: "POST" }),
  resumeSource: (id: number) => request<{ ok: true }>(`/api/sources/${id}/resume`, { method: "POST" }),
  removeSource: (id: number) => request<{ ok: true }>(`/api/sources/${id}`, { method: "DELETE" }),

  listEntries: (filter: string) =>
    request<{
      entries: Entry[];
      counts: { source_type: SourceType; n: number }[];
      tagCounts: { tag: string; n: number }[];
      lastRun: Run | null;
      nextAt: string | null;
      clusters: Cluster[];
    }>(`/api/entries?filter=${encodeURIComponent(filter)}`),
  getEntry: (id: string) =>
    request<{ entry: Entry; thread: Thread | null; voiceCount: number }>(`/api/entries/${id}`),
  draftThread: (entryId: number) =>
    request<{ thread: Thread; voiceCount: number }>(`/api/entries/${entryId}/draft`, { method: "POST" }),
  listDrafts: (filter: string) =>
    request<{ threads: DraftListItem[]; counts: { total: number; unposted: number; posted: number } }>(
      `/api/threads?filter=${encodeURIComponent(filter)}`,
    ),
  saveThread: (id: number, tweets: string[]) =>
    request<{ ok: true }>(`/api/threads/${id}`, { method: "PUT", body: JSON.stringify({ draft_json: tweets }) }),
  markPosted: (id: number) => request<{ ok: true }>(`/api/threads/${id}/posted`, { method: "POST" }),
  unmarkPosted: (id: number) => request<{ ok: true }>(`/api/threads/${id}/unposted`, { method: "POST" }),
  dismissEntry: (id: number) => request<{ ok: true }>(`/api/entries/${id}/dismiss`, { method: "POST" }),
  restoreEntry: (id: number) => request<{ ok: true }>(`/api/entries/${id}/restore`, { method: "POST" }),

  getCluster: (id: string) =>
    request<{ cluster: Cluster; members: ClusterMember[]; thread: Thread | null; voiceCount: number }>(
      `/api/clusters/${id}`,
    ),
  draftClusterThread: (clusterId: number) =>
    request<{ thread: Thread; voiceCount: number }>(`/api/clusters/${clusterId}/draft`, { method: "POST" }),
  dismissCluster: (id: number) => request<{ ok: true }>(`/api/clusters/${id}/dismiss`, { method: "POST" }),

  listRuns: () => request<{ runs: Run[]; running: number | null; nextAt: string | null }>("/api/runs"),
  getRun: (id: number) => request<{ run: Run; sources: RunSource[]; entries: RunEntry[] }>(`/api/runs/${id}`),
  triggerRun: () => request<{ runId: number | null; alreadyRunning: boolean }>("/api/runs/trigger", { method: "POST" }),

  getSettings: () => request<SettingsPayload>("/api/settings"),
  saveSettings: (values: Record<string, string>) =>
    request<{ ok: true }>("/api/settings", { method: "PUT", body: JSON.stringify(values) }),
  clearHistory: () =>
    request<{ ok: true; cleared: { entries: number; runs: number; clusters: number; drafts: number }; keptVoice: number }>(
      "/api/settings/clear-history",
      { method: "POST" },
    ),
};

/* ---------- display helpers (timestamps stored UTC, rendered local) ---------- */

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86_400_000).toDateString() === date.toDateString();
  const hm = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (sameDay) return `today ${hm}`;
  if (yesterday) return `yesterday ${hm}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${hm}`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDuration(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export const TYPE_LABELS: Record<SourceType, string> = {
  youtube: "YouTube",
  twitter: "X",
  hn: "Hacker News",
  rss: "RSS",
};

export const TYPE_BADGES: Record<SourceType, string> = {
  youtube: "YT",
  twitter: "X",
  hn: "HN",
  rss: "RSS",
};
