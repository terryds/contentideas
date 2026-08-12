import { Hono } from "hono";
import { db } from "../db/db";
import { nextRunAt, runOnce, runningRunId } from "../scheduler";

const runs = new Hono();

runs.get("/", (c) => {
  const rows = db
    .prepare(
      `SELECT r.*, (SELECT COUNT(*) FROM run_sources rs WHERE rs.run_id = r.id) AS sources_count
       FROM runs r ORDER BY r.id DESC LIMIT 100`,
    )
    .all();
  return c.json({ runs: rows, running: runningRunId(), nextAt: nextRunAt() });
});

runs.get("/:id", (c) => {
  const run = db.prepare("SELECT * FROM runs WHERE id = ?").get(c.req.param("id"));
  if (!run) return c.json({ error: "Run not found" }, 404);
  const sources = db
    .prepare("SELECT * FROM run_sources WHERE run_id = ? ORDER BY id")
    .all(c.req.param("id"));
  return c.json({ run, sources });
});

runs.post("/trigger", (c) => {
  if (runningRunId() !== null) {
    return c.json({ runId: runningRunId(), alreadyRunning: true });
  }
  // runOnce inserts the run row synchronously before its first await, so the id
  // is available immediately; the fetch/filter work continues in the background.
  runOnce("manual").catch((err) => console.error("[run] manual run crashed:", err));
  return c.json({ runId: runningRunId(), alreadyRunning: false });
});

export default runs;
