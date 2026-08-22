# Thread studio — generation, editor, voice pool

## What & why

The payoff: one click turns a matched item into a Twitter-thread draft in the owner's voice; they edit, copy-paste to X, and mark it posted — and each posted final makes the next draft sound more like them (few-shot feedback loop). This is why the tool exists beyond being an alert feed.

## Behavior

- **Generate** (`POST /api/entries/:id/draft`): `llm/generator.ts` composes the `claude -p` input:
  1. Generation prompt (settings).
  2. Voice examples: `final_text` of the last N posted threads (N from settings; skip section entirely when pool is empty).
  3. Item material: title + URL + content; **for YouTube, the transcript** (fetch now if missing — this is the retry path when the on-match fetch failed; truncate very long transcripts to fit a sane input size, keep the beginning + a middle sample).
  - Output contract *(upgraded 2026-08-20)*: schema-validated structured output (`--json-schema`, `{tweets: string[]}`) — 3–6 tweets requested, shape guaranteed by the CLI; normalized (trimmed, empties dropped, capped) in code. One retry. Stored as `threads.draft_json`; entry `state=drafted`.
- **Editor** ([mockup](../../planning/4-mockups/editor.html)), route `/item/:id`:
  - Left: filter's take + source material (transcript in a scrollable mono block with word count, or tweet text / summary), link out.
  - Right: one auto-sizing textarea per tweet (**`field-sizing: content` + generous min-height — boxes always fit their text**, per mockup feedback), `n / total` label, live char count, **over-280 turns crimson bold** (visual warning only — the owner may intend it for X Premium).
  - Actions: **Regenerate** (replaces draft after confirm — edits would be lost), **+ Add tweet**, **Copy all** (primary; full thread to clipboard, tweets separated by blank lines), **✓ Mark as posted** (green).
  - Edits save to `draft_json` (debounced PUT). Voice note under the draft: "generated with your last N posted threads as style examples."
- **Mark as posted:** stores current edited text as `final_text`, sets `posted_at`, entry `state=posted`. Caption under the button says exactly this ("saves this final text as a voice example"). Undo-able (open question below).
- **Empty/error states:** generation failure → inline error card with the `claude -p` error and a Retry button, entry stays `matched`; regenerating never deletes the previous draft until the new one parses successfully.

## Auto-drafts *(added 2026-08-20)*

- Two owner-controlled triggers, both running at the end of each cron run (after filter/notify/trending), generating **ordinary thread rows** — Regenerate/edit/posted work identically to hand-clicked drafts:
  - **Trending** (`auto_draft_trending`, ON by default): every active at-threshold cluster with no thread yet gets a cluster draft.
  - **Tags** (`auto_draft_tags`, owner-selected subset of the vocabulary, empty = off): every entry judged *this run* that matched with at least one selected tag and has no thread yet gets an entry draft.
- Generation logic extracted to `server/drafts.ts` (shared by the routes and the auto pass; includes the YouTube transcript retry). Auto-drafting failures degrade the run (recorded, never fatal); each entry/cluster is attempted once per run, and having a thread makes it permanently skipped.
- **Draft digest:** one Telegram message per run listing what was auto-drafted — bold title, source/cluster link, first-tweet preview. Informational: a failed send is recorded but NOT retried (the drafts exist; the dashboard shows them).

## Drafts tab *(added 2026-08-20)*

New nav page listing every thread ever drafted: subject title (entry's or cluster's), kind (source label / 📈 trending), first-tweet preview, updated time, Posted chip, filter chips (All / Unposted / Posted), each row linking into the editor (`/item/:id` or `/cluster/:id`). Served by `GET /api/threads` (joined with entries/clusters for titles).

## Architecture mapping

`server/llm/generator.ts`, `server/fetchers/transcript.ts`, `server/routes/threads.ts`, `web/src/pages/Editor.tsx`.

## Edge cases & open questions

- Copy-all format: tweets separated by a blank line, no numbering (numbering is UI-only) — the owner pastes into X's composer one tweet at a time or a thread tool.
- A drafted-then-dismissed entry keeps its thread row (harmless orphan).
- Open: "unmark as posted" — cheap to add (clear final_text/posted_at); include if trivial during M4.
- Open: transcript truncation threshold — pick by trial in M5 (claude CLI context is large; start ~15k words).
