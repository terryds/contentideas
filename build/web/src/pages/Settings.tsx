import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatClock } from "../api";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { Field } from "../components/Field";

const SECRET_MASK = "••••••••••••";

interface TestState {
  status: "idle" | "busy" | "ok" | "fail";
  message?: string;
  at?: string;
}

const SECTION_OF: Record<string, string> = {
  check_interval: "Schedule",
  telegram_bot_token: "Telegram",
  telegram_chat_id: "Telegram",
  floxy_host: "Floxy proxy",
  floxy_port: "Floxy proxy",
  floxy_username: "Floxy proxy",
  floxy_password: "Floxy proxy",
  twitter_auth_token: "Twitter CLI",
  twitter_ct0: "Twitter CLI",
  taste_prompt: "Taste filter prompt",
  generation_prompt: "Thread generation prompt",
  voice_examples_count: "Thread generation prompt",
  trending_threshold: "Trending",
};

export function Settings() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [secretsSet, setSecretsSet] = useState<Record<string, boolean>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const [clearing, setClearing] = useState(false);
  const [clearNote, setClearNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await api.getSettings();
    const plain: Record<string, string> = {};
    for (const [key, value] of Object.entries(data.values)) plain[key] = value ?? "";
    setValues(plain);
    setSecretsSet(Object.fromEntries(Object.entries(data.secrets).map(([k, v]) => [k, v.set])));
    setDirty({});
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const edit = (key: string, value: string) => {
    setDirty((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const current = (key: string) => dirty[key] ?? values[key] ?? "";

  const dirtySections = useMemo(() => {
    const sections = new Set<string>();
    for (const key of Object.keys(dirty)) sections.add(SECTION_OF[key] ?? key);
    return [...sections];
  }, [dirty]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.saveSettings(dirty);
      await load();
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (name: "telegram" | "proxy" | "twitter") => {
    setTests((t) => ({ ...t, [name]: { status: "busy" } }));
    try {
      const res = await fetch(`/api/test/${name}`, { method: "POST" });
      const body = (await res.json()) as { message?: string; error?: string };
      const at = formatClock(new Date().toISOString());
      if (res.ok) {
        setTests((t) => ({ ...t, [name]: { status: "ok", message: body.message, at } }));
      } else {
        setTests((t) => ({ ...t, [name]: { status: "fail", message: body.error ?? "failed", at } }));
      }
    } catch {
      setTests((t) => ({ ...t, [name]: { status: "fail", message: "Server not responding" } }));
    }
  };

  const testNote = (name: string) => {
    const t = tests[name];
    if (!t || t.status === "idle") return null;
    if (t.status === "busy") return <span className="t-small">Testing…</span>;
    if (t.status === "ok")
      return (
        <span style={{ color: "var(--good)", fontSize: 13, fontWeight: 600 }}>
          ✓ {t.message === "Delivered" ? `Delivered ${t.at}` : t.message}
        </span>
      );
    return <span style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600 }}>✕ {t.message}</span>;
  };

  const secretField = (key: string, label: string) => (
    <Field label={label}>
      <input
        type="password"
        placeholder={secretsSet[key] && !(key in dirty) ? SECRET_MASK : "not set"}
        value={dirty[key] ?? ""}
        onChange={(e) => edit(key, e.target.value)}
      />
    </Field>
  );

  return (
    <main>
      <h1>Settings</h1>
      <p className="page-note">
        Credentials, schedule, and the two prompts that define your engine. Secrets live only in the local SQLite file.
      </p>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Schedule</h2>
        <p className="sec-note">How often every active source gets checked.</p>
        <Field label="Check interval" style={{ maxWidth: 220 }}>
          <select value={current("check_interval")} onChange={(e) => edit("check_interval", e.target.value)}>
            <option value="15m">Every 15 minutes</option>
            <option value="30m">Every 30 minutes</option>
            <option value="1h">Every hour</option>
            <option value="3h">Every 3 hours</option>
            {current("check_interval") === "1m" && <option value="1m">Every minute (test)</option>}
          </select>
        </Field>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Telegram</h2>
        <p className="sec-note">Where match notifications go.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 20px" }}>
          {secretField("telegram_bot_token", "Bot token")}
          <Field label="Chat ID">
            <input
              type="text"
              className="mono-input"
              value={current("telegram_chat_id")}
              onChange={(e) => edit("telegram_chat_id", e.target.value)}
            />
          </Field>
        </div>
        <div className="row">
          <Button onClick={() => runTest("telegram")} disabled={tests.telegram?.status === "busy"}>
            Send test message
          </Button>
          {testNote("telegram")}
        </div>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Floxy proxy</h2>
        <p className="sec-note">
          Residential IPs for YouTube fetches — a fresh session (new IP) is generated for every fetch.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 20px" }}>
          <Field label="Host">
            <input type="text" className="mono-input" value={current("floxy_host")} onChange={(e) => edit("floxy_host", e.target.value)} />
          </Field>
          <Field label="Port">
            <input type="text" className="mono-input" value={current("floxy_port")} onChange={(e) => edit("floxy_port", e.target.value)} />
          </Field>
          <Field label="Username">
            <input type="text" className="mono-input" value={current("floxy_username")} onChange={(e) => edit("floxy_username", e.target.value)} />
          </Field>
          {secretField("floxy_password", "Password")}
        </div>
        <div className="row">
          <Button onClick={() => runTest("proxy")} disabled={tests.proxy?.status === "busy"}>
            Test connection
          </Button>
          {testNote("proxy")}
        </div>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Twitter CLI</h2>
        <p className="sec-note">Cookies for twitter-cli (profile fetching). From your logged-in browser session.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "0 20px" }}>
          {secretField("twitter_auth_token", "TWITTER_AUTH_TOKEN")}
          {secretField("twitter_ct0", "TWITTER_CT0")}
        </div>
        <div className="row">
          <Button onClick={() => runTest("twitter")} disabled={tests.twitter?.status === "busy"}>
            Test auth
          </Button>
          {testNote("twitter")}
        </div>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Taste filter prompt</h2>
        <p className="sec-note">
          Runs via <code>claude -p</code> against every new entry. The MATCH/SKIP output contract is enforced in code —
          your taste lives here.
        </p>
        <Field label="Prompt" style={{ maxWidth: "none" }}>
          <textarea rows={6} value={current("taste_prompt")} onChange={(e) => edit("taste_prompt", e.target.value)} />
        </Field>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Thread generation prompt</h2>
        <p className="sec-note">
          Runs when you click "Draft thread". Your last posted threads are appended automatically as voice examples.
        </p>
        <Field label="Prompt" style={{ maxWidth: "none" }}>
          <textarea rows={5} value={current("generation_prompt")} onChange={(e) => edit("generation_prompt", e.target.value)} />
        </Field>
        <Field label="Voice examples to include" style={{ maxWidth: 220 }}>
          <select value={current("voice_examples_count")} onChange={(e) => edit("voice_examples_count", e.target.value)}>
            <option value="3">Last 3 posted threads</option>
            <option value="5">Last 5 posted threads</option>
            <option value="10">Last 10 posted threads</option>
          </select>
        </Field>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24 }}>
        <h2>Trending</h2>
        <p className="sec-note">
          When the same story appears in several sources within 48 hours, you get one Telegram ping — regardless of
          the taste filter's verdict.
        </p>
        <Field label="Notify when a story appears in N sources" style={{ maxWidth: 300 }}>
          <select value={current("trending_threshold")} onChange={(e) => edit("trending_threshold", e.target.value)}>
            {[2, 3, 4, 5].map((n) => (
              <option key={n} value={String(n)}>
                {n} sources
              </option>
            ))}
          </select>
        </Field>
      </Card>

      <Card style={{ padding: 24, marginBottom: 24, borderColor: "var(--accent)" }}>
        <h2 style={{ color: "var(--accent)" }}>Danger zone</h2>
        <p className="sec-note" style={{ maxWidth: "65ch" }}>
          Clear history data deletes all ingested entries, run history, trending clusters, and unposted drafts.
          Your sources, settings, and posted threads (the voice examples) are kept. On the next check every source
          re-imports its current items as already seen — nothing gets re-notified; only new posts from then on.
        </p>
        <div className="row">
          <Button
            variant="primary"
            disabled={clearing}
            onClick={async () => {
              if (!confirm("Clear all history data? Entries, runs, clusters, and unposted drafts will be deleted. Sources, settings, and posted threads are kept.")) return;
              setClearing(true);
              setClearNote(null);
              try {
                const res = await api.clearHistory();
                setClearNote(
                  `Cleared ${res.cleared.entries} entries, ${res.cleared.runs} runs, ${res.cleared.clusters} clusters, ${res.cleared.drafts} drafts — kept ${res.keptVoice} posted thread${res.keptVoice === 1 ? "" : "s"}.`,
                );
              } catch (err) {
                setClearNote(err instanceof Error ? err.message : String(err));
              } finally {
                setClearing(false);
              }
            }}
          >
            {clearing ? "Clearing…" : "Clear history data"}
          </Button>
          {clearNote && <span className="t-small">{clearNote}</span>}
        </div>
      </Card>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--paper)",
          borderTop: "1px solid var(--line)",
          padding: "14px 0",
          display: "flex",
          gap: 12,
          alignItems: "center",
        }}
      >
        <Button variant="primary" onClick={save} disabled={saving || Object.keys(dirty).length === 0}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {saveError ? (
          <span className="t-small" style={{ color: "var(--accent)", fontWeight: 600 }}>
            {saveError}
          </span>
        ) : dirtySections.length > 0 ? (
          <span className="t-small">Unsaved changes in {dirtySections.join(", ")}</span>
        ) : saved ? (
          <span className="t-small" style={{ color: "var(--good)", fontWeight: 600 }}>
            Saved.
          </span>
        ) : (
          <span className="t-small">No unsaved changes.</span>
        )}
      </div>
    </main>
  );
}
