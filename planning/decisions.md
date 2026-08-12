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
