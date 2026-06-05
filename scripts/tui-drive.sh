#!/usr/bin/env bash
# Drive jemacs in a headless tmux pane: send keystrokes, capture rendered text.
#
#   scripts/tui-drive.sh start [args...]       # spawn 120x35 pane
#   scripts/tui-drive.sh keys C-x C-f foo Enter
#   scripts/tui-drive.sh cap                   # plain-text screen → stdout
#   scripts/tui-drive.sh capansi               # with SGR escapes (colour)
#   scripts/tui-drive.sh modeline              # last non-echo line
#   scripts/tui-drive.sh wait 'regex' [secs]   # poll cap until regex matches
#   scripts/tui-drive.sh stop
#
# Keys use tmux key syntax: C-x M-x Escape Enter Space Tab BSpace Up/Down etc.
# Literal text: pass as one arg ("hello world" → typed verbatim).
set -euo pipefail
S=${JEMACS_TMUX_SESSION:-jemacs}

case "${1:-}" in
  start)
    tmux kill-session -t "$S" 2>/dev/null || true
    shift
    tmux new-session -d -s "$S" -x 120 -y 35 \
      "cd $(dirname "$0")/.. && exec bun run src/main.ts $*"
    for _ in $(seq 40); do
      tmux capture-pane -t "$S" -p 2>/dev/null | grep -q 'Jemacs OpenTUI' && exit 0
      sleep 0.1
    done
    echo "jemacs did not draw within 4s" >&2; exit 1 ;;
  keys)
    shift
    for k in "$@"; do
      # tmux key names are single tokens; anything else is literal text
      # tmux treats a trailing ';' on an arg as a command separator (-- doesn't help),
      # so M-; would arrive as 'M-' and a bare ';' key would vanish.
      if [[ "$k" =~ ^(C-|M-|S-|C-M-|Escape$|Enter$|Space$|Tab$|BSpace$|Up$|Down$|Left$|Right$|Home$|End$|PgUp$|PgDn$|F[0-9]+$) ]]; then
        tmux send-keys -t "$S" -- "${k//;/\\;}"
      else
        tmux send-keys -t "$S" -l -- "${k/%;/\\;}"
      fi
      sleep 0.03
    done
    sleep 0.12 ;;
  cap)      tmux capture-pane -t "$S" -p ;;
  capansi)  tmux capture-pane -t "$S" -p -e ;;
  modeline) tmux capture-pane -t "$S" -p | grep -v '^$' | tail -n 2 | head -n 1 ;;
  wait)
    re=${2:?regex}; secs=${3:-5}
    for _ in $(seq "$((secs*10))"); do
      tmux capture-pane -t "$S" -p | grep -qE "$re" && exit 0
      sleep 0.1
    done
    exit 1 ;;
  stop) tmux kill-session -t "$S" 2>/dev/null || true ;;
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
