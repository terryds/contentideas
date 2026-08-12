# Morning report — Content Engine overnight build

**Status: all six milestones (M0–M6) shipped and committed.** One commit per milestone, verification notes in [BUILD-LOG.md](BUILD-LOG.md).

## What shipped

Everything in the v1 feature list, built to spec in `build/`:

- **One Bun process** — Hono API + `Bun.cron` scheduler + static SPA serving, bound to `127.0.0.1:4321`. SQLite at `data/content-engine.db` (gitignored) with idempotent numbered migrations.
- **Sources** — YouTube channel (handle→channel-id resolution, detection via channel RSS), X profile (twitter-cli), HN front page (top 30, Firebase API), RSS/Atom. Add-time validation, pause/resume/remove, 7-day counts, health chips with "see run" deep-links into the failing run.
- **Ingestion** — cron from the interval setting (live re-registration on save), shared `runOnce()` with a concurrent-run guard, per-source isolation, 3 attempts with backoff, human-readable attempt traces, "initial import" rule for new sources, 30-day pruning, runs interrupted by a restart are finalized and labeled.
- **Taste filter** — every pending entry (including leftovers) judged serially via `claude -p`; MATCH/SKIP + one-line reason stored; unparseable → stays pending; CLI missing → run-level error "claude -p failed — is the CLI installed and logged in?".
- **Telegram** — plain-text ping per match, strictly on the `new→notified` transition; failures recorded and resent next run.
- **Thread studio** — generation prompt + last-N posted finals as voice examples + item content/transcript → JSON thread; editor with auto-sizing tweet blocks, over-280 crimson counts, add tweet, regenerate (confirm-guarded, never loses the old draft on parse failure), Copy all, Mark as posted (+ undo). **The feedback loop is verified**: a posted final demonstrably appears in the next generation's prompt.
- **YouTube transcripts** — Innertube player→timedtext flow implemented directly (the trialed libraries can't do per-request proxies); fresh Floxy session per attempt; on-match fetch that never blocks notification; retry at draft time; `[mm:ss]`-blocked transcript in the editor.
- **Settings** — everything per mockup; secrets write-only over the API (GET returns presence); three test buttons wired to real checks.
- **Design** — styleguide tokens, light + dark, serif headings, crimson-C favicon. All five pages screenshot-checked against the mockups in both themes (no console errors).

## How to run

```bash
cd build
bun install
bun run dev      # Vite dev on http://127.0.0.1:5173, API on :4321
# or production-style:
bun run build && bun run start   # everything on http://127.0.0.1:4321
```

`bun` 1.3.14+ and the `claude` CLI (logged in) must be on PATH. The dev database currently contains the overnight test data (HN/RSS/YouTube sources, real filtered entries, one drafted thread) — delete `data/content-engine.db` for a truly fresh start.

## What needs your credentials to finish testing

Everything below is **built and failure-path-tested**; only the green path awaits real credentials (enter them in Settings, each block has a test button):

1. **Telegram** — bot token + chat ID. Then: "Send test message", and a real match should arrive formatted title / source / filter's take / link.
2. **Floxy** — host/port/username/password. Note: I encoded session rotation as `username-session-<id>` in `server/proxy/floxy.ts` (common residential pattern; the spec left it open) — check your Floxy docs and adjust that one template if theirs differs. Then transcripts should flow end-to-end; this box's datacenter IP is bot-blocked by YouTube (verified live), which is exactly what Floxy is for.
3. **twitter-cli** — the binary isn't installed here and the spec's open question (exact subcommand) couldn't be pinned. `server/fetchers/twitter.ts` assumes `twitter-cli tweets <handle> --json` and a whoami-ish `twitter-cli whoami` for Test auth, parses defensively, and fails loudly. Expect to adjust the two invocations to your actual CLI, then set both cookies in Settings.

## Unfinished / caveats

- No automated test suite (spec didn't call for one); verification was live-API + screenshot based, recorded per milestone in BUILD-LOG.md.
- HN slice is a constant (top 30) per spec; quote-tweet inclusion undecided pending real twitter-cli output.
- `Bun.cron` is minute-granularity; the hidden `1m` test interval remains available by writing `check_interval=1m` directly to the settings table (UI offers only the four spec'd options).
- Environment setup done tonight: installed Bun 1.3.14 + `unzip` system-side; repo-local git identity set to your email for the milestone commits.
