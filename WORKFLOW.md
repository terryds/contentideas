# Planning & Brainstorming Workflow

How this project goes from idea → design → code, guided by the `/helpmeplan` skill.
Core idea: **`planning/` is the "src", `spec/` is the "dist".** Phases are working files (messy is fine); the spec folder is the distilled output — the only thing coding needs to read.

## Structure = timeline

```
planning/                 # "src" of planning — one folder per phase, in order
├── 1-brainstorm/ideas.md
├── 2-scope/scope.md
├── 3-design/             # brand.md + styleguide.html
├── 4-mockups/            # one mockup file per UI surface
├── 5-architecture/architecture.md
└── decisions.md          # running log: one line per decision + why
spec/                     # "dist" — distilled build plan, output of all 5 phases
├── README.md             # what + v1 features + not-doing + index
├── plans/                # one plan file per area of this project
├── structure.md          # planned codebase layout
└── roadmap.md            # build order: M0 (walking skeleton) → Mn
build/                    # real code, built from spec/ only, in roadmap order — plus run artifacts (BUILD-LOG.md, MORNING-REPORT.md, logs)
```

**Work happens in `planning/`, conclusions get promoted to `spec/`. If it's not in the spec, it doesn't get built.**

## Phases at a glance

| # | Phase        | Deliverable                    | Done when…                                        |
|---|--------------|--------------------------------|---------------------------------------------------|
| 1 | Brainstorm   | `ideas.md`                     | Ideas run dry                                     |
| 2 | Scope        | `scope.md` (v1 / later / no)   | v1 list fits in one sentence per feature          |
| 3 | Design       | `brand.md` + `styleguide.html` | Styleguide looks right in light AND dark          |
| 4 | Mockups      | one mockup file per UI surface | "I'd be happy if the real thing looked like this" |
| 5 | Architecture | `architecture.md`              | Every mockup element maps to a component/API      |
| — | **Spec**     | `spec/` folder                 | A stranger could build it from `spec/` alone, in roadmap order |

Each deliverable starts with a `Status: in-progress` line that flips to `done` when the phase gate is confirmed — that's how `/helpmeplan` knows where to resume.

## Rules of the road

- Work in `planning/`, promote conclusions to `spec/`. The spec is the contract.
- **Mockups are throwaway.** Never upgrade them into real code — rebuild cleanly with them as reference.
- Log every decision in `planning/decisions.md` — one line + why.
- Don't skip phases without a reason; each has a "done when" gate.
- Build in `spec/roadmap.md` order — M0 (walking skeleton) first, each milestone verified before the next.
- Once coding starts: if reality forces a change, update the relevant `spec/` file first, then the code.

## Usage

- `/helpmeplan` — resume wherever planning left off
- `/helpmeplan status` — where are we?
- `/helpmeplan spec` — distill the `spec/` folder now
- `/helpmeplan redo <n>` — reopen a completed phase
- `./overnight.sh` — offered once the spec ships: launches Claude Code unattended (detached tmux, `bypassPermissions`) to build the spec overnight. Everything lands in `build/` — the code, `build/BUILD-LOG.md` (appended after every milestone), and `build/MORNING-REPORT.md` when done — read those when you wake up. Commit/push everything before running it.
