import { getSetting } from "../db/db";

// The ONLY module that knows how Floxy sessions work. A fresh session id in the
// proxy username buys a fresh residential IP; every protected YouTube attempt
// builds a new one.
//
// Session-rotation scheme: `<username>-session-<id>` — the common residential
// pattern. The spec left the exact format open pending the owner's Floxy account
// docs; if Floxy expects a different encoding (e.g. `-sessid-`), only the
// template below changes.

export interface ProxySession {
  /** Full proxy URL for fetch()'s `proxy` option, credentials embedded. */
  url: string;
  /** The generated session id — logged in attempt traces (never the password). */
  sessionId: string;
}

export function buildProxySession(): ProxySession {
  const host = getSetting("floxy_host");
  const port = getSetting("floxy_port");
  const username = getSetting("floxy_username");
  const password = getSetting("floxy_password");
  if (!host || !port || !username || !password) {
    throw new Error("Floxy proxy not configured — add host, port, username, and password in Settings");
  }
  const sessionId = `ses_${Math.random().toString(36).slice(2, 8)}`;
  const sessionUser = `${username}-session-${sessionId}`;
  return {
    url: `http://${encodeURIComponent(sessionUser)}:${encodeURIComponent(password)}@${host}:${port}`,
    sessionId,
  };
}

/** Settings "Test connection": fetch a known URL through a fresh session. */
export async function testProxy(): Promise<string> {
  const session = buildProxySession();
  let res: Response;
  try {
    res = await fetch("https://www.youtube.com/robots.txt", {
      proxy: session.url,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/407/.test(message)) throw new Error("407 auth failed — check username/password");
    throw new Error(`Proxy connection failed (session ${session.sessionId}): ${message}`);
  }
  if (res.status === 407) throw new Error("407 auth failed — check username/password");
  if (!res.ok) throw new Error(`Proxy fetch returned HTTP ${res.status} (session ${session.sessionId})`);
  return `Connected through session ${session.sessionId}`;
}
