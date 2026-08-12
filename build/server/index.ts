import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { migrate, pruneOldRuns } from "./db/migrate";
import sources from "./routes/sources";
import entries from "./routes/entries";
import runs from "./routes/runs";
import settings from "./routes/settings";

// The one place the port lives. 4321 — unlikely to collide locally.
export const PORT = 4321;

// Boot order per plans/core.md: migrations → prune → (cron registration, M1) → listen.
migrate();
pruneOldRuns();

const app = new Hono();

app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
});

app.route("/api/sources", sources);
app.route("/api/entries", entries);
app.route("/api/runs", runs);
app.route("/api/settings", settings);
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// Production: serve the built SPA from the same process. In dev, Vite serves the
// UI and proxies /api here, so a missing dist is fine.
const distDir = join(import.meta.dir, "..", "web", "dist");
if (existsSync(distDir)) {
  app.use("*", serveStatic({ root: "./web/dist" }));
  app.get("*", serveStatic({ path: "./web/dist/index.html" }));
} else {
  app.get("/", (c) =>
    c.text("Content Engine API is up. Run `bun run build` to serve the dashboard from this process, or use `bun run dev`."),
  );
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // localhost only — never exposed
  fetch: app.fetch,
  idleTimeout: 120,
});

console.log(`Content Engine listening on http://127.0.0.1:${PORT}`);
