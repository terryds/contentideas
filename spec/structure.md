# Planned codebase layout

Everything lives in `build/` (the project root next to `planning/` and `spec/` stays clean). One Bun process serves API + built SPA; `web/` is the Vite workspace.

```
build/
├── package.json            # scripts: dev (server + vite dev), build (vite build), start (bun server/index.ts)
├── tsconfig.json
├── .gitignore              # data/, web/dist/, node_modules/
├── server/
│   ├── index.ts            # entry: boot DB migrations, register Bun.cron job, start Hono on 127.0.0.1
│   ├── db/
│   │   ├── db.ts           # bun:sqlite connection singleton (data/content-engine.db)
│   │   ├── migrate.ts      # idempotent migrations, run at boot; prunes runs > 30 days
│   │   └── schema.sql      # sources, entries, threads, runs, run_sources, settings
│   ├── scheduler.ts        # Bun.cron registration, interval-setting → cron expression, runOnce() shared by cron + "Run now"
│   ├── fetchers/
│   │   ├── types.ts        # Fetcher interface: fetch(source) → NewEntry[]; Entry/NewEntry types
│   │   ├── rss.ts          # generic RSS/Atom
│   │   ├── hackernews.ts   # HN Firebase API, front page
│   │   ├── twitter.ts      # twitter-cli subprocess (env from settings)
│   │   ├── youtube.ts      # detection via channel RSS feed
│   │   └── transcript.ts   # getTranscript(videoId) — the ONLY file that knows the transcript library; uses proxy/floxy.ts
│   ├── proxy/
│   │   └── floxy.ts        # buildProxySession(): fresh-session credentials per call, from settings
│   ├── llm/
│   │   ├── claude.ts       # runClaude(prompt, input): claude -p subprocess, timeout, defensive parse, one retry
│   │   ├── filter.ts       # taste filter: entry → {matched, reason}
│   │   └── generator.ts    # thread generation: item + prompt + voice examples → string[]
│   ├── notify/
│   │   └── telegram.ts     # sendMatch(entry), sendTest()
│   └── routes/             # one Hono router per resource, mounted under /api
│       ├── entries.ts      # GET /api/entries?state=…, POST /api/entries/:id/dismiss
│       ├── threads.ts      # POST /api/entries/:id/draft, PUT /api/threads/:id, POST /api/threads/:id/posted
│       ├── sources.ts      # CRUD + pause/resume
│       ├── runs.ts         # GET /api/runs, GET /api/runs/:id, POST /api/runs/trigger
│       ├── settings.ts     # GET/PUT /api/settings (secrets write-only: GET returns presence, not values)
│       └── test.ts         # POST /api/test/{telegram,proxy,twitter}
├── web/
│   ├── index.html
│   ├── vite.config.ts      # dev proxy → 127.0.0.1 API port; build output web/dist served by server
│   └── src/
│       ├── main.tsx        # router: / /item/:id /sources /runs /settings
│       ├── api.ts          # typed fetch helpers for /api/*
│       ├── styles/tokens.css  # design tokens from planning/3-design/styleguide.html (light + dark, three-state pattern)
│       ├── components/     # Nav, Card, Chip, Button, Field — styleguide components
│       └── pages/
│           ├── Inbox.tsx
│           ├── Editor.tsx
│           ├── Sources.tsx
│           ├── Runs.tsx
│           └── Settings.tsx
└── data/
    └── content-engine.db   # SQLite incl. secrets — gitignored, never leaves the machine
```

## Conventions

- TypeScript everywhere; Bun runs `server/` directly (no build step server-side).
- New source types = one new file in `server/fetchers/` implementing `Fetcher`, plus a type-select option in Sources UI. Nothing else changes.
- All `claude -p` calls go through `llm/claude.ts` — never spawn it elsewhere.
- All Floxy usage goes through `proxy/floxy.ts`; only `transcript.ts` (and any future protected YouTube call) imports it.
- API errors return `{error: string}` with a proper status; the SPA surfaces them verbatim — plain language, actionable (see the Runs mockup's 407 hint).
- Timestamps stored as ISO-8601 UTC strings; rendered in local time by the SPA.
- Visual rules come from `planning/3-design/brand.md`: serif headings, 8px grid, crimson = brand + failure, green = happy path.
