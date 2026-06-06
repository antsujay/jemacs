# AGENTS.md

## Workflow

- Prefer small, focused changes that match the existing TypeScript style.
- Run `bun run check` and `bun test` after code changes when possible.
- If `bun` is not on `PATH`, run those commands through `npx bun`, e.g. `npx bun run check` and `npx bun test`.
- After implementing a feature, fix, or Emacs port, commit the change before handing work back to the user (unless they asked you not to commit).

## Self-modification

- Extension surface is tracked in `src/runtime/definitions.ts` (catalog) with source locations from `captureCallerSource`.
- Live eval: `eval-defun`, `load-file`, `reload-current-file`; revert via `revert-definition` / `revert-all-definitions`.
- Eval context: `src/runtime/jemacs-runtime.ts`. Do not bypass `editor.command`, `defcustom`, `registerKeyBinding`, etc., if the goal is user-visible source links.

## Emacs fidelity

When porting or replicating a GNU Emacs interactive function:

- **Name:** Register the command under the same GNU name (kebab-case, e.g. `beginning-of-buffer`). Do not invent Jemacs-specific command names unless Emacs has no equivalent.
- **Behavior:** Match Emacs semantics for that command; check `lisp/` or the manual when unsure.
- **Key:** Wire default Emacs keybindings in `src/config/default-bindings.ts` (or user `~/.jemacs/init.ts`) via `editor.key` / `editor.defineKey` — never hardcode in `handleKey()`. Commands live in `src/core/`. See `DEFAULT_KEYBINDINGS.md`.
- **TypeScript identifiers:** Hyphenated Emacs names map to camelCase in code (`beginning-of-buffer` → helpers like `beginningOfBuffer`); the public command string stays kebab-case.

## UI hosts

- Kernel and redisplay: `src/kernel/`, `src/display/build-display-model.ts` — no `@opentui/*` or Electron imports.
- Terminal: `OpenTuiHost` in `src/ui/opentui-host.ts`; GUI: `ElectronHost` in `src/ui/electron-host.ts`.
- Bootstrap: `runJemacs()` / `bindJemacsHost()` in `src/run.ts`.
- Optional native editor pane: `JEMACS_USE_TEXTAREA=1` (selected window; font-lock via `syncSpans` + `opentui-textarea-sync.ts`).
- Shared GUI DOM: `src/display/dom-frame.ts` (used by `src/electron/renderer.ts`).
- Workspace packages: `packages/jemacs-core`, `host-opentui`, `host-electron` (re-exports; app still runs from repo root).

## Verification

### Jemacs TUI (tmux)

When verifying non-Electron features, exercise the real OpenTUI host in tmux — unit tests build `KeyEventLike` by hand and miss terminal key-encoding bugs.

```bash
export JEMACS_TMUX_SESSION=jt
scripts/tui-drive.sh start [file]          # sets JEMACS_INIT_PATH to test/fixtures/empty-config.ts
scripts/tui-drive.sh keys Tab Enter
scripts/tui-drive.sh cap                   # eyeball screen
scripts/tui-drive.sh stop
```

`tui-drive.sh` uses `scripts/bun-cmd.sh` (`bun` or `npx bun`). Startup waits up to 12s for the first frame.

### Emacs parity (tmux)

When porting GNU/Stephen Emacs behavior (major modes, hooks, keymaps), compare against **Stephen's Emacs** in tmux — not batch `emacs --batch` (markdown-mode hooks such as inline images fail there).

```bash
export JEMACS_PARITY_EMACS=1
scripts/emacs-drive.sh start examples/docs/guide.md
scripts/emacs-drive.sh keys Tab
scripts/emacs-drive.sh cap
scripts/emacs-drive.sh stop

# Automated parity suite (jemacs + emacs, same keys, compare buffer/echo):
npx bun test test/tui/markdown-parity.test.ts
```

Set `JEMACS_SKIP_TUI=1` or run in CI to skip layer-3 tests. Set `JEMACS_PARITY_EMACS=1` locally to enable Emacs-side parity checks.

Parity harness: `test/harness/tui.ts`, `test/harness/emacs.ts`, `test/harness/parity.ts`, `test/harness/screen.ts`.
