import type { Editor } from "../../src/kernel/editor"

/** No-op user config for tmux drive / parity tests (avoids broken ~/.jemacs/init.ts). */
export function install(_editor: Editor): void {}
