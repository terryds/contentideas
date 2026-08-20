import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatTime, TYPE_BADGES } from "../api";
import type { Source, SourceType } from "../api";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";

const TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: "youtube", label: "YouTube channel" },
  { value: "twitter", label: "X profile" },
  { value: "hn", label: "Hacker News front page" },
  { value: "rss", label: "RSS feed" },
];

function healthCell(source: Source) {
  if (!source.active) return <Chip tone="neutral">Paused</Chip>;
  if (!source.health_status) return <span className="t-small">not checked yet</span>;
  if (source.health_status === "ok") return <Chip tone="good">OK</Chip>;
  if (source.health_status === "retrying") return <Chip tone="warn">Retrying</Chip>;
  const hint = source.health_error?.split("\n")[0] ?? "failed";
  return (
    <>
      <Chip tone="bad">Failed ×3</Chip>{" "}
      <span className="t-small">
        {hint.length > 60 ? hint.slice(0, 60) + "…" : hint} —{" "}
        <Link to={source.health_run_id ? `/runs?open=${source.health_run_id}` : "/runs"}>see run</Link>
      </span>
    </>
  );
}

const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "15m", label: "every 15 min" },
  { value: "30m", label: "every 30 min" },
  { value: "1h", label: "every hour" },
  { value: "3h", label: "every 3 hours" },
  { value: "6h", label: "every 6 hours" },
  { value: "12h", label: "every 12 hours" },
  { value: "24h", label: "daily" },
];

export function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [type, setType] = useState<SourceType>("youtube");
  const [input, setInput] = useState("");
  const [checkInterval, setCheckInterval] = useState("30m");
  const [maxRecords, setMaxRecords] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setSources((await api.listSources()).sources);
    } catch {
      /* global banner covers unreachable */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    setError(null);
    setAdding(true);
    try {
      await api.addSource(type, input, checkInterval, maxRecords);
      setInput("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  };

  const updateCadence = async (id: number, cadence: { check_interval?: string; max_records?: number }) => {
    try {
      await api.updateSource(id, cadence);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (source: Source) => {
    if (!confirm(`Remove ${source.display_name}? Its entries and drafts are kept.`)) return;
    await api.removeSource(source.id);
    load();
  };

  return (
    <main>
      <h1>Sources</h1>
      <p className="page-note">
        {sources.length
          ? `${sources.length} source${sources.length === 1 ? "" : "s"} · each checked on its own schedule · YouTube goes through Floxy with a fresh IP per fetch.`
          : "Add your first source — the next run will pick it up."}
      </p>

      <Card style={{ marginBottom: 24 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ margin: 0, maxWidth: "none" }}>
            <span>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value as SourceType)}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {type !== "hn" && (
            <label className="field" style={{ margin: 0, width: 320, maxWidth: "100%" }}>
              <span>URL or handle</span>
              <input
                type="text"
                className={error ? "error" : ""}
                placeholder={
                  type === "youtube" ? "youtube.com/@channel or @handle" : type === "twitter" ? "@handle" : "https://…/feed.xml"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </label>
          )}
          <label className="field" style={{ margin: 0, maxWidth: "none" }}>
            <span>Check</span>
            <select value={checkInterval} onChange={(e) => setCheckInterval(e.target.value)}>
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ margin: 0, width: 110 }}>
            <span>Max records</span>
            <input
              type="number"
              min={1}
              max={100}
              value={maxRecords}
              onChange={(e) => setMaxRecords(Number(e.target.value))}
            />
          </label>
          <Button variant="primary" onClick={add} disabled={adding || (type !== "hn" && !input.trim())}>
            {adding ? "Adding…" : "Add source"}
          </Button>
        </div>
        {error && <div className="field-error">{error}</div>}
      </Card>

      {sources.length > 0 && (
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Source</th>
                  <th>Check</th>
                  <th>Max</th>
                  <th>Last checked</th>
                  <th>New (7d)</th>
                  <th>Matched (7d)</th>
                  <th>Health</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} style={source.active ? undefined : { opacity: 0.5 }}>
                    <td>
                      <span
                        className="src"
                        style={{
                          fontWeight: 700,
                          fontSize: 12,
                          borderRadius: 5,
                          padding: "3px 7px",
                          background: "var(--paper)",
                          border: "1px solid var(--line)",
                          color: "var(--muted)",
                        }}
                      >
                        {TYPE_BADGES[source.type]}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{source.display_name}</div>
                      <div className="src" style={{ color: "var(--muted)", fontSize: 12 }}>
                        {source.handle_or_url}
                      </div>
                    </td>
                    <td>
                      <select
                        value={source.check_interval}
                        style={{ fontSize: 13, padding: "5px 8px" }}
                        onChange={(e) => updateCadence(source.id, { check_interval: e.target.value })}
                      >
                        {INTERVAL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        defaultValue={source.max_records}
                        style={{ width: 64, fontSize: 13, padding: "5px 8px" }}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (n !== source.max_records) updateCadence(source.id, { max_records: n });
                        }}
                      />
                    </td>
                    <td className="num">{source.active ? formatTime(source.last_checked) : "—"}</td>
                    <td className="num">{source.active ? source.new_7d : "—"}</td>
                    <td className="num">{source.active ? source.matched_7d : "—"}</td>
                    <td>{healthCell(source)}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {source.active ? (
                        <Button variant="ghost" onClick={() => api.pauseSource(source.id).then(load)}>
                          Pause
                        </Button>
                      ) : (
                        <Button variant="ghost" onClick={() => api.resumeSource(source.id).then(load)}>
                          Resume
                        </Button>
                      )}
                      <Button variant="quiet" onClick={() => remove(source)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </main>
  );
}
