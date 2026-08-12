import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatTime } from "../api";
import type { Entry, Thread } from "../api";
import { Card } from "../components/Card";

// M0 shell — the thread studio (generation, tweet blocks, voice pool) lands in M4.
export function Editor() {
  const { id } = useParams();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getEntry(id)
      .then((data) => setEntry(data.entry))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);

  if (error) return <main><div className="banner-error">{error}</div></main>;
  if (!entry) return <main><p className="t-small">Loading…</p></main>;

  return (
    <main>
      <div className="t-small" style={{ marginBottom: 16 }}>
        <Link to="/">← Inbox</Link>
      </div>
      <h1 style={{ fontSize: 24 }}>{entry.title}</h1>
      <div className="t-small">
        <span className="src">{entry.source_label}</span> · added {formatTime(entry.created_at)}
        {entry.url && (
          <>
            {" · "}
            <a href={entry.url} target="_blank" rel="noreferrer">
              Open ↗
            </a>
          </>
        )}
      </div>
      <Card style={{ marginTop: 24 }}>
        <p className="sec-lbl">Source material</p>
        <p style={{ margin: 0, maxWidth: "65ch" }}>{entry.content || "No summary captured for this entry."}</p>
      </Card>
      <Card>
        <p className="t-small" style={{ margin: 0 }}>
          Thread drafting arrives with the Thread studio milestone.
        </p>
      </Card>
    </main>
  );
}
