import { migrate, pruneOldRuns } from "./db/migrate";
import { registerSchedule } from "./scheduler";
import { db, nowIso } from "./db/db";
import { createApp } from "./app";

// The one place the port lives. 4321 — unlikely to collide locally.
export const PORT = 4321;

// Boot order per plans/core.md: migrations → prune → cron registration → listen.
migrate();
pruneOldRuns();

// A run that was in flight when the process died would show "Running…" forever.
db.prepare(
  `UPDATE runs SET finished_at = ?, error_text = COALESCE(error_text || char(10), '') || 'Run interrupted by a server restart — entries stay pending and are picked up next run.'
   WHERE finished_at IS NULL`,
).run(nowIso());

registerSchedule();

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // localhost only — never exposed
  fetch: createApp().fetch,
  idleTimeout: 120,
});

console.log(`Content Engine listening on http://127.0.0.1:${PORT}`);
