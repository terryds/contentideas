import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, formatTime } from "../api";
import type { Entry, Thread } from "../api";
import { Button } from "../components/Button";
import { Card } from "../components/Card";

function wordCount(text: string): string {
  return text.split(/\s+/).filter(Boolean).length.toLocaleString();
}

export function Editor() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [tweets, setTweets] = useState<string[] | null>(null);
  const [threadId, setThreadId] = useState<number | null>(null);
  const [posted, setPosted] = useState(false);
  const [voiceCount, setVoiceCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const autoStarted = useRef(false);

  const applyThread = (thread: Thread | null) => {
    if (thread) {
      setTweets(JSON.parse(thread.draft_json) as string[]);
      setThreadId(thread.id);
      setPosted(!!thread.posted_at);
    } else {
      setTweets(null);
      setThreadId(null);
      setPosted(false);
    }
  };

  const generate = useCallback(async (entryId: number) => {
    setGenerating(true);
    setGenError(null);
    try {
      const result = await api.draftThread(entryId);
      applyThread(result.thread);
      setVoiceCount(result.voiceCount);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    api
      .getEntry(id)
      .then((data) => {
        setEntry(data.entry);
        applyThread(data.thread);
        setVoiceCount(data.voiceCount);
        if (searchParams.get("draft") === "1" && !data.thread && !autoStarted.current) {
          autoStarted.current = true;
          setSearchParams({}, { replace: true });
          generate(data.entry.id);
        }
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const scheduleSave = (next: string[]) => {
    setTweets(next);
    if (!threadId) return;
    setSaveState("saving");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await api.saveThread(threadId, next);
        setSaveState("saved");
      } catch {
        setSaveState("idle");
      }
    }, 800);
  };

  const regenerate = () => {
    if (!entry) return;
    if (tweets && !confirm("Regenerate the thread? Your edits to the current draft will be replaced.")) return;
    generate(entry.id);
  };

  const copyAll = async () => {
    if (!tweets) return;
    // Blank line between tweets, no numbering — numbering is UI-only.
    await navigator.clipboard.writeText(tweets.filter((t) => t.trim()).join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const markPosted = async () => {
    if (!threadId) return;
    clearTimeout(saveTimer.current);
    if (tweets) await api.saveThread(threadId, tweets); // capture latest edits as the final text
    await api.markPosted(threadId);
    setPosted(true);
    setEntry((e) => (e ? { ...e, state: "posted" } : e));
  };

  const unmarkPosted = async () => {
    if (!threadId) return;
    await api.unmarkPosted(threadId);
    setPosted(false);
    setEntry((e) => (e ? { ...e, state: "drafted" } : e));
  };

  if (loadError)
    return (
      <main>
        <div className="banner-error">{loadError}</div>
        <Link to="/">← Back to Inbox</Link>
      </main>
    );
  if (!entry)
    return (
      <main>
        <p className="t-small">Loading…</p>
      </main>
    );

  const linkLabel =
    entry.source_type === "youtube" ? "Watch on YouTube ↗" : entry.source_type === "hn" ? "Open on HN ↗" : "Open source ↗";

  return (
    <main>
      <div className="t-small" style={{ marginBottom: 16 }}>
        <Link to="/">← Inbox</Link>
      </div>
      <h1 style={{ fontSize: 24, lineHeight: 1.2 }}>{entry.title}</h1>
      <div className="t-small">
        <span className="src">{entry.source_label}</span>
        {" · "}
        {entry.filtered_at ? `matched ${formatTime(entry.filtered_at)}` : `added ${formatTime(entry.created_at)}`}
        {entry.url && (
          <>
            {" · "}
            <a href={entry.url} target="_blank" rel="noreferrer">
              {linkLabel}
            </a>
          </>
        )}
      </div>

      <div className="cols">
        <div>
          <Card>
            {entry.filter_reason && (
              <>
                <p className="sec-lbl">Filter's take</p>
                <p style={{ margin: "0 0 20px", maxWidth: "60ch" }}>{entry.filter_reason}</p>
              </>
            )}
            {entry.transcript ? (
              <>
                <p className="sec-lbl">
                  Transcript{" "}
                  <span style={{ textTransform: "none", letterSpacing: 0 }}>
                    · fetched via proxy, {wordCount(entry.transcript)} words
                  </span>
                </p>
                <div className="transcript">{entry.transcript}</div>
              </>
            ) : (
              <>
                <p className="sec-lbl">Source material</p>
                <p style={{ margin: 0, maxWidth: "60ch", whiteSpace: "pre-wrap" }}>
                  {entry.content || "No summary captured for this entry."}
                </p>
                {entry.source_type === "youtube" && (
                  <p className="t-small" style={{ marginTop: 12 }}>
                    No transcript yet — it will be fetched (via the proxy) when you draft the thread.
                  </p>
                )}
              </>
            )}
          </Card>
        </div>

        <div>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
            <p className="sec-lbl" style={{ margin: 0 }}>
              Thread draft
            </p>
            {tweets && (
              <Button onClick={regenerate} disabled={generating}>
                {generating ? "Regenerating…" : "↻ Regenerate"}
              </Button>
            )}
          </div>

          {genError && (
            <Card style={{ borderColor: "var(--accent)" }}>
              <p className="sec-lbl" style={{ color: "var(--accent)" }}>
                Generation failed
              </p>
              <p className="src" style={{ color: "var(--accent)", whiteSpace: "pre-wrap", margin: "0 0 16px" }}>
                {genError}
              </p>
              <Button variant="primary" onClick={() => generate(entry.id)} disabled={generating}>
                Retry
              </Button>
            </Card>
          )}

          {!tweets && !genError && (
            <Card>
              {generating ? (
                <p className="t-small" style={{ margin: 0 }}>
                  Drafting… <code>claude -p</code> is writing your thread. This can take a minute.
                </p>
              ) : (
                <>
                  <p className="t-small" style={{ margin: "0 0 16px" }}>
                    No draft yet for this item.
                  </p>
                  <Button variant="primary" onClick={() => generate(entry.id)}>
                    Draft thread
                  </Button>
                </>
              )}
            </Card>
          )}

          {tweets && (
            <>
              {tweets.map((tweet, i) => (
                <div className="tweet" key={i}>
                  <textarea
                    value={tweet}
                    readOnly={posted}
                    onChange={(e) => {
                      const next = [...tweets];
                      next[i] = e.target.value;
                      scheduleSave(next);
                    }}
                  />
                  <div className="foot">
                    <span className="tno">
                      {i + 1} / {tweets.length}
                    </span>
                    <span className={`count${tweet.length > 280 ? " over" : ""}`}>{tweet.length} / 280</span>
                  </div>
                </div>
              ))}

              {!posted && (
                <Button variant="quiet" style={{ marginBottom: 4 }} onClick={() => scheduleSave([...tweets, ""])}>
                  + Add tweet
                </Button>
              )}

              {voiceCount > 0 && (
                <div className="voice-note">
                  <b>Voice:</b> generated with your last {voiceCount} posted thread{voiceCount === 1 ? "" : "s"} as
                  style examples.
                </div>
              )}

              <div className="row">
                <Button variant="primary" onClick={copyAll}>
                  {copied ? "Copied ✓" : "Copy all"}
                </Button>
                {posted ? (
                  <>
                    <span className="chip chip-good">Posted</span>
                    <Button variant="ghost" onClick={unmarkPosted}>
                      Unmark as posted
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="good" onClick={markPosted}>
                      ✓ Mark as posted
                    </Button>
                    <span className="t-small">Marking as posted saves this final text as a voice example.</span>
                  </>
                )}
                {saveState === "saved" && !posted && <span className="t-small">Saved.</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
