#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock
mkdir -p build
LOG="build/overnight-$(date +%Y%m%d-%H%M).log"
PROMPT='Build the Content Engine project from spec/ only, entirely inside the build/
directory — never write files outside build/. Read spec/README.md first, then lay out
the code in build/ following spec/structure.md (Bun + Hono + SQLite backend, React/Vite
SPA, bound to 127.0.0.1 only). Work through spec/roadmap.md in milestone order, starting
at M0 (the walking skeleton). The area plans in spec/plans/ are the source of truth for
behavior, states, and edge cases; the mockups in planning/4-mockups/ and
planning/3-design/styleguide.html define what the UI must look like — reference them,
but never copy mockup code into the real app. Verify each milestone'\''s "done when"
before advancing, and git commit after each milestone. After each milestone, append an
entry to build/BUILD-LOG.md: what you built, how you verified the "done when", and any
deviation from spec and why. External services (Floxy proxy, Twitter auth tokens,
Telegram bot token) will not have real credentials overnight — read the settings plan
for how missing credentials should degrade, stub or gracefully skip live calls, and
note in BUILD-LOG.md what needs real credentials to test. When finished or blocked,
write build/MORNING-REPORT.md: what shipped, how to run and test it, and what is
unfinished and why.'
command -v tmux >/dev/null 2>&1 || {
  echo "tmux is required. Install it first: brew install tmux / apt install tmux / pkg install tmux (Termux)" >&2
  exit 1
}
SESSION="overnight-contentideas"
tmux has-session -t "$SESSION" 2>/dev/null && {
  echo "A tmux session named '$SESSION' already exists — a build may already be running." >&2
  echo "Watch it:  tmux attach -t $SESSION" >&2
  echo "Or end it: tmux kill-session -t $SESSION  (then re-run this script)" >&2
  exit 1
}
# resolve claude to an absolute path — tmux spawns a non-login shell whose PATH
# may not include ~/.local/bin
CLAUDE_BIN="$(command -v claude || true)"
[ -z "$CLAUDE_BIN" ] && [ -x "$HOME/.local/bin/claude" ] && CLAUDE_BIN="$HOME/.local/bin/claude"
[ -z "$CLAUDE_BIN" ] && { echo "claude CLI not found (checked PATH and ~/.local/bin)" >&2; exit 1; }
# interactive TUI (not -p print mode): attaching shows the live session; piping
# would both blind the pane and buffer the output, so the pane runs claude directly
CMD="$(printf %q "$CLAUDE_BIN") $(printf %q "$PROMPT") --permission-mode bypassPermissions"
tmux new-session -d -s "$SESSION" "$CMD"
# raw pane capture as the log (includes escape codes; BUILD-LOG.md is the readable record)
tmux pipe-pane -t "$SESSION" -o "cat >> $(printf %q "$PWD/$LOG")"
echo "Agent running in tmux session '$SESSION' — watch: tmux attach -t $SESSION (detach: Ctrl+B d)"
echo "Raw log: $LOG · readable record: build/BUILD-LOG.md · morning: build/MORNING-REPORT.md"
