#!/usr/bin/env bash
# Print the command prefix to run bun in this repo (bun or npx bun).
set -euo pipefail
if command -v bun >/dev/null 2>&1; then
  printf '%s\n' bun
else
  printf '%s\n' "npx bun"
fi
