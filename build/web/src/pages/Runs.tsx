import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatClock, formatDuration, formatTime, parseTags } from "../api";
import type { Run, RunEntry, RunSource } from "../api";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";

// One line per entry the run touched: verdict chip, title, the filter's own
// reasoning, and what happened Telegram-wise — the "why didn't X get picked
// up?" answer, per record.
function EntryRow({ entry }: { entry: RunEntry }) {
  const chip =
    entry.filter_status === "matched" ? (
      <Chip tone="good">Matched</Chip>
    ) : entry.filter_status === "pending" ? (
      <Chip tone="warn">Pending</Chip>
    ) : entry.filter_reason === "initial import" ? (
      <Chip tone="neutral">Initial import</Chip>
    ) : (
      <Chip tone="neutral">Skipped</Chip>
    );

  const outcome =
    entry.filter_status === "matched"
      ? entry.state === "new"
        ? { text: "notification not sent yet — see run errors above", tone: "var(--warn)" }
        : { text: "sent to Telegram ✓", tone: "var(--good)" }
      : null;

  return (
    <div style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
      <div className="row" style={{ gap: 10 }}>
        {chip}
        <span className="src" style={{ color: "var(--muted)" }}>{entry.source_label}</span>
        {entry.filter_status === "matched" ? (
          <Link to={`/item/${entry.id}`} style={{ fontWeight: 600 }}>{entry.title}</Link>
        ) : entry.url ? (
          <a href={entry.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--ink)" }}>
            {entry.title}
          </a>
        ) : (
          <span style={{ fontWeight: 600 }}>{entry.title}</span>
        )}
        {entry.score != null && <Chip tone={entry.score >= 7 ? "good" : "neutral"}>★{entry.score}</Chip>}
        {parseTags(entry.tags).map((tag) => (
          <Chip key={tag} tone="neutral">
            #{tag}
          </Chip>
        ))}
      </div>
      {entry.filter_status === "pending" ? (
        <div className="t-small" style={{ marginTop: 4 }}>
          Not judged yet — the filter didn't reach this entry (claude unavailable or run aborted). It will be
          re-filtered on the next run.
        </div>
      ) : (
        entry.filter_reason &&
        entry.filter_reason !== "initial import" && (
          <div className="t-small" style={{ marginTop: 4, maxWidth: "75ch" }}>
            {entry.filter_status === "matched" ? "why it matched: " : "why it was skipped: "}
            {entry.filter_reason}
          </div>
        )
      )}
      {entry.filter_reason === "initial import" && (
        <div className="t-small" style={{ marginTop: 4 }}>
          First fetch of this source — recorded as already seen, never filtered or notified.
        </div>
      )}
      {outcome && (
        <div className="t-small" style={{ marginTop: 2, color: outcome.tone, fontWeight: 600 }}>{outcome.text}</div>
      )}
    </div>
  );
}

type RunWithCount = Run & { sources_count: number };

function runChip(run: RunWithCount, running: number | null) {
  if (run.id === running || !run.finished_at) return <Chip tone="warn">Running…</Chip>;
  if (run.failed_count > 0) return <Chip tone="bad">{run.failed_count} failed</Chip>;
  if (run.error_text) return <Chip tone="bad">Failed</Chip>;
  return <Chip tone="good">OK</Chip>;
}

/** Plain-language pointer to the likely fix, derived from the error text. */
function hintFor(errorText: string): { text: string; link?: { to: string; label: string } } | null {
  if (/407|proxy/i.test(errorText))
    return {
      text: "Looks like a credential issue — ",
      link: { to: "/settings", label: "check Floxy settings" },
    };
  if (/not configured/i.test(errorText))
    return { text: "Missing credentials — ", link: { to: "/settings", label: "add them in Settings" } };
  if (/claude/i.test(errorText))
    return { text: "claude -p failed — is the CLI installed and logged in?" };
  return null;
}

function RunRow({
  run,
  running,
  defaultOpen = false,
}: {
  run: RunWithCount;
  running: number | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<RunSource[] | null>(null);
  const [entries, setEntries] = useState<RunEntry[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !sources) {
      const detail = await api.getRun(run.id);
      setSources(detail.sources);
      setEntries(detail.entries ?? []);
    }
  };

  useEffect(() => {
    if (defaultOpen && !open) toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultOpen]);

  const duration = run.finished_at
    ? formatDuration(new Date(run.finished_at).getTime() - new Date(run.started_at).getTime())
    : "…";

  return (
    <div className="card" style={{ padding: 0, marginBottom: 12 }}>
      <div
        className="row"
        style={{ padding: "14px 20px", cursor: "pointer", gap: "8px 20px" }}
        onClick={toggle}
      >
        <span className="src" style={{ fontWeight: 700, fontSize: 13 }}>
          #{run.id}
        </span>
        <span className="src" style={{ color: "var(--muted)" }}>
          {formatTime(run.started_at)} · {run.sources_count} sources · {run.new_count} new ·{" "}
          {run.matched_count} matched · {duration}
        </span>
        <span style={{ flex: 1 }} />
        {runChip(run, running)}
        <span className="t-small">{open ? "▼" : "▶"}</span>
      </div>
      {open && (
        <div style={{ borderTop: "1px solid var(--line)", padding: "6px 20px 16px" }}>
          {run.error_text && (
            <>
              <div
                className="src"
                style={{
                  background: "var(--accent-bg)",
                  color: "var(--accent)",
                  borderRadius: 6,
                  padding: "10px 14px",
                  margin: "10px 0 4px",
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.6,
                }}
              >
                {run.error_text}
              </div>
              {hintFor(run.error_text) && (
                <div className="t-small" style={{ marginBottom: 8 }}>
                  {hintFor(run.error_text)!.text}
                  {hintFor(run.error_text)!.link && (
                    <Link to={hintFor(run.error_text)!.link!.to}>{hintFor(run.error_text)!.link!.label}</Link>
                  )}
                </div>
              )}
            </>
          )}
          {!sources ? (
            <p className="t-small">Loading…</p>
          ) : sources.length === 0 ? (
            <p className="t-small">No active sources in this run.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Source</th>
                      <th>New</th>
                      <th>Matched</th>
                      <th>Duration</th>
                      <th>Attempts</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.map((s) => (
                      <tr key={s.id}>
                        <td className="num">{s.source_label}</td>
                        <td className="num">{s.status === "failed" ? "—" : s.new_count}</td>
                        <td className="num">{s.status === "failed" ? "—" : s.matched_count}</td>
                        <td className="num">{formatDuration(s.duration_ms)}</td>
                        <td className="num">{s.attempts}</td>
                        <td>
                          {s.status === "ok" ? (
                            <Chip tone="good">OK</Chip>
                          ) : s.status === "retrying" ? (
                            <Chip tone="warn">Retried</Chip>
                          ) : (
                            <Chip tone="bad">Failed</Chip>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {entries && entries.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <p className="sec-lbl" style={{ marginBottom: 6 }}>
                    Entries this run touched · {entries.filter((e) => e.filter_status === "matched").length} matched
                    of {entries.length}
                  </p>
                  {entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} />
                  ))}
                </div>
              )}
              {sources
                .filter((s) => s.error_text)
                .map((s) => {
                  const hint = hintFor(s.error_text!);
                  return (
                    <div key={s.id}>
                      <div
                        className="src"
                        style={{
                          background: "var(--accent-bg)",
                          color: "var(--accent)",
                          borderRadius: 6,
                          padding: "10px 14px",
                          margin: "10px 0 4px",
                          whiteSpace: "pre-wrap",
                          lineHeight: 1.6,
                        }}
                      >
                        {s.source_label}: {s.error_text}
                      </div>
                      {hint && (
                        <div className="t-small">
                          {hint.text}
                          {hint.link && <Link to={hint.link.to}>{hint.link.label}</Link>}
                          {s.status === "failed" &&
                            " Filter step was skipped for this source; nothing was lost, entries will be picked up next run."}
                        </div>
                      )}
                    </div>
                  );
                })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function Runs() {
  const [runs, setRuns] = useState<RunWithCount[]>([]);
  const [running, setRunning] = useState<number | null>(null);
  const [nextAt, setNextAt] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [searchParams] = useSearchParams();
  const openId = Number(searchParams.get("open")) || null;
  const timer = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const data = await api.listRuns();
      setRuns(data.runs as RunWithCount[]);
      setRunning(data.running);
      setNextAt(data.nextAt);
      setLoaded(true);
    } catch {
      /* global banner */
    }
  }, []);

  useEffect(() => {
    load();
    // Live-ish while open: a run in progress shows as its own row and updates.
    timer.current = setInterval(load, 4000);
    return () => clearInterval(timer.current);
  }, [load]);

  const runNow = async () => {
    await api.triggerRun();
    load();
  };

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h1>Cron runs</h1>
        <Button onClick={runNow} disabled={running !== null}>
          {running !== null ? "Running…" : "▶ Run now"}
        </Button>
      </div>
      <p className="page-note">Every scheduled check, newest first. Click a run to see per-source details and errors.</p>

      {!loaded ? (
        <p className="t-small">Loading…</p>
      ) : runs.length === 0 ? (
        <div className="card empty">
          <h2>No runs yet</h2>
          <p className="t-small">
            {nextAt ? `Next check at ${formatClock(nextAt)}.` : "Trigger a check to see per-source results here."}
          </p>
          <Button onClick={runNow} style={{ marginTop: 8 }}>
            ▶ Run now
          </Button>
        </div>
      ) : (
        runs.map((run) => (
          <RunRow
            key={`${run.id}-${run.finished_at ?? "live"}`}
            run={run}
            running={running}
            defaultOpen={run.id === openId}
          />
        ))
      )}

      <p className="t-small" style={{ marginTop: 24 }}>
        Runs older than 30 days are pruned automatically.
      </p>
    </main>
  );
}
