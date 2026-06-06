#!/bin/sh
# Kill any leaked jemacs tui-probe sessions and bun processes.
tmux ls 2>/dev/null | grep -E '^(jt|jv|qa|jterm)' | cut -d: -f1 | xargs -rn1 tmux kill-session -t 2>/dev/null
pkill -f 'bun run.*src/main.ts' 2>/dev/null
pkill -f 'bun.*jemacs' 2>/dev/null || true
