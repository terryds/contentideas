// The Hono app, side-effect free: no migrations, no cron, no listening.
// index.ts boots it for real; tests exercise it via createApp().request().

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { join } from "node:path";
import sources from "./routes/sources";
import entries from "./routes/entries";
import threads from "./routes/threads";
import runs from "./routes/runs";
import clusters from "./routes/clusters";
import settings from "./routes/settings";
import test from "./routes/test";

export function createApp(): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[api]", err);
    return c.json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  });

  app.route("/api/sources", sources);
  app.route("/api/entries", entries);
  app.route("/api", threads); // /api/entries/:id/draft + /api/threads/:id*
  app.route("/api/runs", runs);
  app.route("/api/clusters", clusters);
  app.route("/api/settings", settings);
  app.route("/api/test", test);
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

  return app;
}
