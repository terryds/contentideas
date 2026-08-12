import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatClock, formatDuration, formatTime } from "../api";
import type { Run, RunSource } from "../api";
import { Button } from "../components/Button";
import { Chip } from "../components/Chip";

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

function RunRow({ run, running }: { run: RunWithCount; running: number | null }) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<RunSource[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !sources) {
      setSources((await api.getRun(run.id)).sources);
    }
  };

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
  const timer = useRef<ReturnType<typeof setInterval>>();

  const load = useCallback(async () => {
    try {
      const data = await api.listRuns();
      setRuns(data.runs as RunWithCount[]);
      setRunning(data.running);
      setNextAt(data.nextAt);
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

      {runs.length === 0 ? (
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
        runs.map((run) => <RunRow key={`${run.id}-${run.finished_at ?? "live"}`} run={run} running={running} />)
      )}

      <p className="t-small" style={{ marginTop: 24 }}>
        Runs older than 30 days are pruned automatically.
      </p>
    </main>
  );
}
