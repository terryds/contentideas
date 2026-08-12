import { Hono } from "hono";
import { sendTest } from "../notify/telegram";
import { testProxy } from "../proxy/floxy";
import { testAuth } from "../fetchers/twitter";

// Credential test buttons on the Settings page. Success → {ok, message};
// failure → {error} with actionable text, status 400.
const test = new Hono();

function asError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

test.post("/telegram", async (c) => {
  try {
    await sendTest();
    return c.json({ ok: true, message: "Delivered" });
  } catch (err) {
    return c.json({ error: asError(err) }, 400);
  }
});

test.post("/proxy", async (c) => {
  try {
    return c.json({ ok: true, message: await testProxy() });
  } catch (err) {
    return c.json({ error: asError(err) }, 400);
  }
});

test.post("/twitter", async (c) => {
  try {
    return c.json({ ok: true, message: `Logged in as ${await testAuth()}` });
  } catch (err) {
    return c.json({ error: asError(err) }, 400);
  }
});

export default test;
