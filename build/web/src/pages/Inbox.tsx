import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatTime, TYPE_LABELS } from "../api";
import type { Entry, Run, SourceType } from "../api";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "youtube", label: "YouTube" },
  { key: "twitter", label: "X" },
  { key: "hn", label: "Hacker News" },
  { key: "rss", label: "RSS" },
  { key: "dismissed", label: "Dismissed" },
];

function sourceMeta(entry: Entry): string {
  const time = entry.filtered_at && entry.filter_status === "matched"
    ? `matched ${formatTime(entry.filtered_at)}`
    : `added ${formatTime(entry.created_at)}`;
  return time;
}

function EntryCard({
  entry,
  onDismiss,
  onRestore,
}: {
  entry: Entry;
  onDismiss: (id: number) => void;
  onRestore: (id: number) => void;
}) {
  const navigate = useNavigate();
  const posted = entry.state === "posted";
  const drafted = entry.state === "drafted";
  const dismissed = entry.state === "dismissed";

  return (
    <Card style={posted ? { opacity: 0.75 } : undefined}>
      <div className="item-title">{entry.title}</div>
      <div className="t-small" style={{ marginTop: 4 }}>
        <span className="src">{entry.source_label}</span> · {sourceMeta(entry)}
        {drafted && (
          <>
            {" · "}
            <Chip tone="good">Drafted</Chip>
          </>
        )}
        {posted && (
          <>
            {" · "}
            <Chip tone="good">Posted</Chip>
          </>
        )}
      </div>
      {entry.filter_reason && !posted && (
        <div style={{ margin: "10px 0 16px", maxWidth: "65ch" }}>
          <span className="sec-lbl" style={{ marginBottom: 0 }}>
            Filter's take
          </span>
          <br />
          {entry.filter_reason}
        </div>
      )}
      <div className="row" style={{ marginTop: posted || !entry.filter_reason ? 12 : 0 }}>
        {posted ? (
          <Button onClick={() => navigate(`/item/${entry.id}`)}>View thread</Button>
        ) : drafted ? (
          <Button onClick={() => navigate(`/item/${entry.id}`)}>Open draft</Button>
        ) : (
          <Button variant="primary" onClick={() => navigate(`/item/${entry.id}`)}>
            Draft thread
          </Button>
        )}
        {entry.url && !posted && (
          <a href={entry.url} target="_blank" rel="noreferrer" style={{ fontSize: 14, fontWeight: 600 }}>
            {entry.source_type === "youtube" ? "Watch ↗" : entry.source_type === "hn" ? "Open on HN ↗" : "Open ↗"}
          </a>
        )}
        {dismissed ? (
          <Button variant="quiet" onClick={() => onRestore(entry.id)}>
            Restore
          </Button>
        ) : (
          !posted && (
            <Button variant="quiet" onClick={() => onDismiss(entry.id)}>
              Dismiss
            </Button>
          )
        )}
      </div>
    </Card>
  );
}

export function Inbox() {
  const [filter, setFilter] = useState("all");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [counts, setCounts] = useState<Partial<Record<SourceType, number>>>({});
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [checking, setChecking] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout>>();

  const load = useCallback(async (f: string) => {
    try {
      const data = await api.listEntries(f);
      setEntries(data.entries);
      setCounts(Object.fromEntries(data.counts.map((c) => [c.source_type, c.n])));
      setLastRun(data.lastRun);
    } catch {
      /* banner handles unreachable; other errors leave the page as-is */
    }
  }, []);

  useEffect(() => {
    load(filter);
    return () => clearTimeout(pollTimer.current);
  }, [filter, load]);

  const runNow = async () => {
    setChecking(true);
    try {
      await api.triggerRun();
      const poll = async () => {
        const { running } = await api.listRuns();
        if (running === null) {
          setChecking(false);
          load(filter);
        } else {
          pollTimer.current = setTimeout(poll, 2000);
        }
      };
      pollTimer.current = setTimeout(poll, 2000);
    } catch {
      setChecking(false);
    }
  };

  const dismiss = async (id: number) => {
    await api.dismissEntry(id);
    load(filter);
  };
  const restore = async (id: number) => {
    await api.restoreEntry(id);
    load(filter);
  };

  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <main>
      <h1>Inbox</h1>
      <p className="page-note">
        Everything your taste filter matched, newest first.
        {lastRun && <> Last check {formatTime(lastRun.finished_at)}.</>}
      </p>

      <div className="row" style={{ marginBottom: 24, gap: 8 }}>
        {FILTERS.map((f) => {
          const count =
            f.key === "all" ? total : f.key === "dismissed" ? null : counts[f.key as SourceType] ?? 0;
          if (f.key !== "all" && f.key !== "dismissed" && !count) return null;
          return (
            <span
              key={f.key}
              className="chip chip-neutral"
              role="button"
              tabIndex={0}
              onClick={() => setFilter(f.key)}
              onKeyDown={(e) => e.key === "Enter" && setFilter(f.key)}
              style={
                filter === f.key
                  ? { background: "var(--ink)", color: "var(--paper)", cursor: "pointer" }
                  : { cursor: "pointer" }
              }
            >
              {f.label}
              {count != null ? ` · ${count}` : ""}
            </span>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <Card className="empty">
          <div className="mark">C</div>
          <h2>{filter === "dismissed" ? "Nothing dismissed" : "All caught up"}</h2>
          <p className="t-small">
            {lastRun
              ? `Last check ${formatTime(lastRun.finished_at)} — ${lastRun.new_count} new entries, ${lastRun.matched_count} matched.`
              : "No checks have run yet. Add sources, then run a check."}
          </p>
          {filter !== "dismissed" && (
            <Button onClick={runNow} disabled={checking} style={{ marginTop: 8 }}>
              {checking ? "Checking…" : "Run check now"}
            </Button>
          )}
        </Card>
      ) : (
        entries.map((entry) => (
          <EntryCard key={entry.id} entry={entry} onDismiss={dismiss} onRestore={restore} />
        ))
      )}
    </main>
  );
}
