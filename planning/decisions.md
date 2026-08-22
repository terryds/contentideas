# Decisions

One line per decision + why. Append-only.

<!-- - [phase] chose X over Y — because Z -->
- [brainstorm] one global taste-filter prompt over per-source prompts — simpler for v1
- [brainstorm] tech stack Bun + SQLite — user's choice, single-user internal tool
- [brainstorm] YouTube via Floxy residential proxy with fresh session/IP per fetch — YT bot protection is aggressive
- [brainstorm] Twitter via twitter-cli (TWITTER_AUTH_TOKEN + TWITTER_CT0) — existing tool, no official API cost
- [brainstorm] review/edit + copy-paste over a "post it" button — safer, no bad draft goes live
- [brainstorm] HN source = front page; RSS feeds added as 4th source type; no Reddit for now
- [brainstorm] feedback loop in v1 = few-shot injection of posted finals into generation prompt — zero extra machinery, "mark as posted" is the only user action
- [scope] entire core pipeline ships in v1 (12 features) — user's call; someday-list stays parked
- [design] name "Content Engine", tagline "Fuel for your feed" — user's pick
- [design] clean & editorial vibe: light-first, warm paper neutrals, serif headings, quiet chrome
- [design] crimson #9E1B32 (dark: #E86A80) as sole accent; doubles as failure/destructive color; green = matched/OK so happy ≠ alarming
- [design] system font stacks only (Iowan serif / system sans / SF Mono) — local tool, no webfonts
- [mockups] 5 surfaces: inbox (landing), editor, sources, runs, settings — matches the 12 v1 features
- [mockups] filter's one-line "why it matched" shown on every inbox card — makes the taste prompt debuggable
- [mockups] Telegram needs a bot token + chat ID (both in settings) — token was implied, now explicit
- [mockups] failed fetches don't lose entries — picked up on next run; per-source failure never blocks other sources
- [mockups] item lifecycle chips: Matched → Drafted → Posted (green family); Dismissed hidden behind a filter
- [architecture] React SPA (Vite) + Bun/Hono JSON API — user's pick over server-rendered
- [architecture] in-process scheduling with native Bun.cron (verified in Bun 1.3.12) over system cron or an interval timer — run history and "Run now" come free in one process, no dependency
- [architecture] YouTube detection via channel RSS feeds; Floxy proxy (fresh IP/attempt) only for transcripts — cheapest path past bot protection
- [architecture] HN via official Firebase API — no scraping needed for front page
- [architecture] entries deduped on (source_id, external_id); filter failure leaves entry pending, retried next run — nothing lost
- [architecture] secrets in local SQLite, server binds 127.0.0.1 only — single-user tool, DB never enters git
- [spec] first fetch of a new source = "initial import" (all skipped, not notified) — avoids Telegram-blasting a channel's back catalog
- [spec] secrets are write-only over the API (GET returns presence, not values) — dashboard never round-trips credentials
- [spec] prompts split: user's taste/voice text in settings, output contracts (MATCH/SKIP, JSON array) enforced in code — customization can't break parsing
- [spec] roadmap M0 walking skeleton (RSS e2e) → M1 scheduler+runs+HN → M2 settings → M3 filter+Telegram → M4 thread studio → M5 YouTube/Floxy → M6 Twitter+polish
- [v1.1] cross-source trending: two-tier identity (normalized URL match + topic-slug overlap from the existing filter claude -p call — no extra API calls) — cheapest path to "same story, different sources"
- [v1.1] trending notifies regardless of taste-filter verdict — frequency is its own signal; threshold configurable (default 2 sources); 48h clustering window as a code constant
- [v1.1] notify once per cluster at threshold crossing, never per new member — anti-spam
- [v1.2] tests in three layers: unit (fixtures), integration (temp SQLite + localhost fixture feed + stubbed claude bin), live (opt-in, owner's real sources) — deterministic fast suite, flaky-by-nature checks quarantined behind LIVE
- [v1.2] full-pipeline e2e lives in the integration layer with stubs; the live layer only smoke-tests external boundaries — a live failure then points at exactly one integration
- [v1.2] Floxy session rotation encodes in the PASSWORD (`_session-<alnum>_lifetime-<s>`), pinned from a real credential — the username-suffix guess would 407 forever
- [v1.2] `bun run doctor` + root AGENTS.md/CLAUDE.md — every external integration was once broken by a wrong assumption; onboarding now starts with a checkup instead of a 3am cron failure
- [v1.2] clear-history keeps posted threads — wiping history shouldn't lobotomize the learned voice; re-import lands as initial-import so clearing never re-blasts Telegram
- [v1.2] initial-import rule REMOVED (reverses the M1-era decision) — owner prefers full judgment on first fetches and post-clear re-imports over a silent baseline, accepting per-item claude cost and notification bursts
- [v1.2] per-source cadence over one global interval — each source sets check_interval + max_records at add time (editable inline); scheduler = one master minute-tick fetching only due sources; global Schedule setting removed
- [v1.2] filter judgments 3-concurrent (was serial) — full judgment of first fetches made serial runtime unacceptable; abort semantics preserved
- [v1.2] clock-mode schedules: per-source "at set times" (HH:MM list) in ONE global timezone setting — per-source timezones rejected as overkill; missed slots fire exactly once at boot, never queue
- [v1.2] tags ride the existing filter call (third contract line, vocabulary-constrained, sanitized on parse) — classification costs zero extra claude calls; model can never invent labels
- [v1.2] LLM seam migrated to claude -p --json-schema structured outputs — schema-enforced shapes (tag vocabulary as enum) replace regex line contracts; doctor verifies --json-schema support at onboarding
- [v1.2] auto-drafts: trending ON by default, tag-triggered opt-in per tag; drafts generated once per subject (existing thread = permanent skip); draft digest is informational (no retry — the drafts exist either way)
