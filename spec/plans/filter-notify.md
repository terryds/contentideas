# Filter & notify — taste filter, Telegram, inbox

## What & why

The judgment layer: every ingested entry is judged by the owner's taste prompt via `claude -p`; matches ping Telegram and land in the Inbox with a one-line "why". Exists so the owner reads only what fits their taste — and can debug the taste prompt because every verdict shows its reason.

## Behavior

- **Tags** *(added 2026-08-20)*: the owner defines a tag vocabulary in Settings (comma-separated, e.g. `ai-coding, indie-hacking, launches`). When non-empty, the filter's output contract gains a third line — `TAGS: <zero or more, strictly from the vocabulary>` — so every entry (matched AND skipped) is classified in the same `claude -p` call, no extra cost. Tags outside the vocabulary are discarded on parse; empty vocabulary disables the line entirely. Tags show as chips on Inbox cards and in per-run entry detail; the Inbox filter row gains one chip per tag (with counts) that filters matched entries by tag; digest bullets append the tags as Telegram hashtags (`#ai_coding` — hyphens become underscores so Telegram links them).
- **Filter pass** (runs inside `runOnce()` after fetching): for each `filter_status=pending` entry — including leftovers from previous runs — call `llm/filter.ts`:
  - Input: taste prompt (settings) + entry title, source, content. Output contract *(upgraded 2026-08-20)*: **schema-validated structured output** via `claude -p --output-format json --json-schema` — `{matched, reason, topics[], tags[]}`, with the tag vocabulary embedded as a schema enum so off-list tags are impossible at the model level (still sanitized in code as belt-and-braces). No text parsing; the CLI's JSON envelope (`is_error`, `structured_output`) is the interface. Requires a Claude Code version with `--json-schema` — the doctor's claude check exercises exactly this path. Filter judgments run on **latest Sonnet** (`--model sonnet`, owner's call 2026-08-20 — classification doesn't need the default frontier model's cost); thread generation stays on the CLI's default model.
  - Result stored on the entry (`matched`/`skipped`, reason, filtered_at). Unparseable output → one retry → still bad → entry stays `pending` (picked up next run). `claude -p` call timeout ~60s.
- **On match:** for YouTube entries, fetch the transcript now (via `transcript.ts`, proxy, retries) — transcript failure does NOT block notification, it's retried when drafting.
- **Notification digest** *(reworked 2026-08-20 — anti-spam)*: all matches from a run go out as **ONE Telegram message**, not one per entry. HTML formatting (`parse_mode: HTML`, previews off): one bullet per match — **bold headline**, the source label as a **hyperlink** to the original URL, and the filter's reason as the summary line. Titles/reasons HTML-escaped; digest capped (long reasons trimmed, past ~20 bullets an "…and N more — see your Inbox" line). Delivered → all included entries `state=notified` in one update. Send failure → recorded once on the run, all stay `state=new`, resent next run.
- **Inbox** ([mockup](../../planning/4-mockups/inbox.html)) — the landing page:
  - Cards newest-first: serif title, source line (`hn:frontpage` mono style, points/duration, matched time), "Filter's take" block, actions: **Draft thread** (primary) / source link / **Dismiss** (quiet).
  - Lifecycle chips per [brand.md](../../planning/3-design/brand.md): Drafted/Posted green; posted cards render dimmed with "View thread".
  - Filter chips: All / per-source-type counts / Dismissed (dismissed hidden by default; `state=dismissed` via Dismiss action, reversible from that filter view).
  - **Empty state:** "All caught up" card — monogram, last-check summary ("6 sources checked, 27 entries filtered"), Run check now button.
  - Header note: "Last check HH:MM — next at HH:MM" (from run history + cron schedule).
- **Error state:** filter systematically failing (e.g. `claude` CLI missing) → run marked failed with error text "claude -p failed — is the CLI installed and logged in?"; entries remain pending, nothing lost.

## Architecture mapping

`server/llm/claude.ts`, `server/llm/filter.ts`, `server/notify/telegram.ts`, `server/routes/entries.ts`, `web/src/pages/Inbox.tsx`.

## Edge cases & open questions

- Filtering serially per entry keeps `claude -p` load sane; a busy first run may take minutes — acceptable, visible in run duration.
- Telegram message must escape markdown-sensitive characters in titles (send plain text).
- Duplicate notification guard: notify only on `new→notified` transition, never re-notify on refilter.
- Open: batch several entries per `claude -p` call if per-entry latency hurts in practice — only if serial proves too slow; keep per-entry as the spec default.
