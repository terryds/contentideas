import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, formatTime } from "../api";
import type { DraftListItem } from "../api";
import { Card } from "../components/Card";
import { Chip } from "../components/Chip";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "unposted", label: "Unposted" },
  { key: "posted", label: "Posted" },
];

function firstTweet(draft: DraftListItem): string {
  try {
    const tweets = JSON.parse(draft.draft_json) as string[];
    return tweets[0] ?? "";
  } catch {
    return "";
  }
}

export function Drafts() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState<DraftListItem[]>([]);
  const [counts, setCounts] = useState({ total: 0, unposted: 0, posted: 0 });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async (f: string) => {
    try {
      const data = await api.listDrafts(f);
      setDrafts(data.threads);
      setCounts(data.counts);
      setLoaded(true);
    } catch {
      /* global banner */
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  const editorPath = (draft: DraftListItem) =>
    draft.cluster_id != null ? `/cluster/${draft.cluster_id}` : `/item/${draft.entry_id}`;

  return (
    <main>
      <h1>Thread drafts</h1>
      <p className="page-note">
        Every thread drafted so far — by you or auto-generated. Click one to edit, regenerate, or mark as posted.
      </p>

      {!loaded && <p className="t-small">Loading…</p>}

      <div className="row" style={{ marginBottom: 24, gap: 8, display: loaded ? undefined : "none" }}>
        {FILTERS.map((f) => {
          const count = f.key === "all" ? counts.total : f.key === "unposted" ? counts.unposted : counts.posted;
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
              {f.label} · {count}
            </span>
          );
        })}
      </div>

      {!loaded ? null : drafts.length === 0 ? (
        <Card className="empty">
          <div className="mark">C</div>
          <h2>No drafts {filter === "all" ? "yet" : filter}</h2>
          <p className="t-small">
            Draft one from a matched item in the Inbox — or let auto-drafting do it (Settings → Auto-drafts).
          </p>
        </Card>
      ) : (
        drafts.map((draft) => (
          <Card
            key={draft.id}
            style={{ cursor: "pointer", ...(draft.posted_at ? { opacity: 0.75 } : {}) }}
            onClick={() => navigate(editorPath(draft))}
          >
            <div className="item-title">{draft.subject_title}</div>
            <div className="t-small" style={{ marginTop: 4 }}>
              {draft.cluster_id != null ? (
                <Chip tone="warn">📈 Trending</Chip>
              ) : (
                <span className="src">{draft.source_label ?? "entry"}</span>
              )}
              {" · updated "}
              {formatTime(draft.updated_at)}
              {draft.posted_at && (
                <>
                  {" · "}
                  <Chip tone="good">Posted</Chip>
                </>
              )}
            </div>
            {firstTweet(draft) && (
              <p className="t-small" style={{ margin: "10px 0 0", maxWidth: "70ch" }}>
                “{firstTweet(draft).slice(0, 200)}
                {firstTweet(draft).length > 200 ? "…" : ""}”
              </p>
            )}
          </Card>
        ))
      )}
    </main>
  );
}
