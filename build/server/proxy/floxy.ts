import { getSetting } from "../db/db";

// The ONLY module that knows how Floxy sessions work. A fresh session id buys a
// fresh residential IP; every protected YouTube attempt builds a new one.
//
// Session-rotation scheme, pinned from a real Floxy credential example
// (host:port:username:password): rotation is encoded in the PASSWORD as
// underscore-delimited suffixes — `<password>_session-<id>_lifetime-<seconds>`,
// e.g. `68f1…_session-6pssgtl6_lifetime-1200`. The username stays bare. Session
// ids must be purely alphanumeric: an underscore inside the id would break
// Floxy's underscore parsing of the password field.

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
  const sessionId = Math.random().toString(36).slice(2, 10); // alphanumeric only
  // 5 min is ample for one transcript fetch; each attempt rotates anyway.
  const sessionPassword = `${password}_session-${sessionId}_lifetime-300`;
  return {
    url: `http://${encodeURIComponent(username)}:${encodeURIComponent(sessionPassword)}@${host}:${port}`,
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
