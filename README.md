# Jemacs OpenTUI

A self-editable Emacs-like editor where JavaScript replaces Emacs Lisp and **pluggable frontends** render the UI: **OpenTUI** (terminal) and **Electron** (GUI). See [PLAN.md](PLAN.md) for architecture and roadmap.

The kernel is ordinary TypeScript: buffers, commands, keymaps, modes, and the evaluator can be inspected and modified from inside the editor.

## Architecture (short)

| Layer | Path | Notes |
| --- | --- | --- |
| Kernel | `src/kernel/` | No OpenTUI, no DOM |
| Display | `src/display/` | `DisplayModel`, `ThemedText`, `build-display-model.ts` |
| Bootstrap | `src/run-core.ts`, `src/run.ts` | `runJemacsCore` (all hosts); `runJemacs` adds TUI input wiring |
| Terminal host | `src/ui/opentui-host.ts` | `OpenTuiHost` |
| GUI host | `src/ui/electron-host.ts` | `ElectronHost` + `src/electron/*` renderer |
| Platform I/O | `src/platform/runtime.ts` | Node-compatible fs/spawn when not under Bun |

Workspace packages under `packages/` re-export modules for a future split; **entrypoints stay at the repo root** (`src/main.ts`, `src/main-electron.ts`).

## Runtime

- **Terminal (`bun run dev`):** Runs on **Bun**. Uses `@opentui/core` (native Zig + TS bindings). OpenTUI is Bun-first upstream; this repo matches that.
- **GUI (`bun run dev:gui`):** Builds with Bun, runs on **Electron (Node)**. The main process does **not** have `Bun` globals — file I/O and subprocesses go through `src/platform/runtime.ts`. **Tree-sitter** grammars stay **external** in the Electron bundle so font-lock works.

Other deps: `tree-sitter` + language grammars (font-lock), `electron` (GUI), LSP protocol types.

## Install

```bash
bun install
```

`postinstall` downloads the Electron binary and builds tree-sitter natives. You need **Bun** to run the TUI and build scripts; **Node** is used inside Electron at runtime.

If native builds fail, install **Zig** (OpenTUI / tree-sitter).

## Run

### Terminal (default)

```bash
bun run dev
bun run src/main.ts README.md
bun run dev:self          # edit src/main.ts in place
```

### GUI (Electron)

```bash
bun run dev:gui           # build + launch (recommended)
# equivalents:
bun run build:gui && npx electron dist/main-electron.js
JEMACS_UI=electron bun run dev
bun run src/main.ts --gui
```

`dev:gui` rebuilds `dist/main-electron.js` and `dist/electron/` (preload, renderer, HTML/CSS) every time.

**Verify GUI without clicking:**

```bash
bun run smoke:gui         # opens window briefly; open-file, font-lock, splits
```

**Browser-only DOM preview** (sample frame, no kernel/IPC):

```bash
bun run preview:gui       # http://localhost:5173/gui-preview.html
```

### Optional: OpenTUI Textarea (terminal)

Native editor surface for the **selected** window only (`JEMACS_USE_TEXTAREA=1`). Uses OpenTUI `TextareaRenderable` with font-lock via `syncSpans` / `opentui-textarea-sync.ts`.

```bash
JEMACS_USE_TEXTAREA=1 bun run dev
```

## Development

```bash
bun run check             # tsc --noEmit
bun test                  # kernel + host + smoke tests
```

Agent/contributor notes: [AGENTS.md](AGENTS.md).

## Keybindings

Commands use **GNU Emacs function names** (`find-file`, `kill-region`, `execute-extended-command`, …). Full tables: [DEFAULT_KEYBINDINGS.md](DEFAULT_KEYBINDINGS.md).

| Key | Emacs command |
| --- | --- |
| Type printable keys | `self-insert-command` |
| Return or Ctrl-J/Ctrl-M | `newline` / `newline-and-indent` |
| Backspace | `delete-backward-char` |
| Left/Right or Ctrl-B/Ctrl-F | `backward-char` / `forward-char` |
| Up/Down or Ctrl-P/Ctrl-N | `previous-line` / `next-line` |
| Ctrl-A / Ctrl-E | `move-beginning-of-line` / `move-end-of-line` |
| Meta-B / Meta-F | `backward-word` / `forward-word` |
| Ctrl-D | `delete-char` |
| Ctrl-K / Ctrl-Y | `kill-line` / `yank` |
| Ctrl-W / Meta-W | `kill-region` / `kill-ring-save` |
| Ctrl-X Ctrl-S | `save-buffer` |
| Ctrl-X Ctrl-E | `eval-region` |
| Ctrl-X B | `switch-to-buffer` |
| Ctrl-X Ctrl-B | `list-buffers` |
| Ctrl-X Ctrl-F | `find-file` |
| Ctrl-Space | `set-mark-command` |
| Ctrl-G | `keyboard-quit` |
| Meta-X / Alt-X / Esc X | `execute-extended-command` |
| Ctrl-H E | `view-echo-area-messages` |
| Ctrl-H C | `describe-mode` |
| Ctrl-H B | `describe-bindings` |
| Ctrl-H K | `describe-key` |
| Meta-G G | `goto-line` |
| Ctrl-X 2 / Ctrl-X 3 | `split-window-below` / `split-window-right` |
| Ctrl-X K | `kill-buffer` |
| Ctrl-C Ctrl-L | `load-plugin` |
| Ctrl-C Ctrl-R | `reload-current-file` |
| Ctrl-X Ctrl-C or Ctrl-C Ctrl-Q | `save-buffers-kill-terminal` |

## Self-editing demo

1. Start against the editor source:

   ```bash
   bun run src/main.ts src/init/default-commands.ts
   ```

2. Edit a command or add a new one.
3. Mark the relevant JavaScript/TypeScript expression or whole buffer.
4. Press `Ctrl-X Ctrl-E`.
5. Open `*messages*` or inspect the editor with `Ctrl-H E`.

Plugin reload: `Ctrl-C Ctrl-L` → path such as `plugins/demo-plugin.ts` (`install(editor)`).

`Ctrl-C Ctrl-R` on a TS/JS buffer saves and cache-bust-imports the file (plugin or `installDefaultCommands`).

On macOS, Option-key encodings map to Meta where possible (`≈` → `M-x`, etc.); `Esc` + key works everywhere.

### Kitty and Ctrl+Tab

`C-tab` / `C-S-tab` → `other-window` / `other-window-backward`. In Kitty, clear default tab bindings so keys reach the app:

```
map ctrl+tab
map ctrl+shift+tab
```

Fallback: `C-x o`. Unbound keys show the resolved token in the echo area.

## GUI troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Window is empty (background only) | Stale build or renderer loaded before IPC; run `bun run dev:gui` again |
| `window.jemacs` / preload errors | Preload must be **CJS** (`dist/electron/preload.js`); rebuild with `build:gui` |
| `Bun is not defined` in GUI | Code path still uses `Bun.*` in Electron main — use `src/platform/runtime.ts` |
| No syntax colors in GUI | Tree-sitter bundled into main; rebuild so grammars stay external (see `scripts/build-electron.ts`) |
| `find-file` fails in GUI | Same as above — `BufferModel.fromFile` uses platform I/O |

Debug font-lock in GUI: `JEMACS_DEBUG_FONT_LOCK=1 bun run dev:gui` (logs tree-sitter errors to the terminal).

## Design notes

The kernel never imports `@opentui/*` or Electron. Hosts consume `DisplayModel` from `build-display-model.ts`:

- **TUI:** `themedTextToStyledText` in `src/ui/opentui-styled.ts`
- **GUI:** `serialize.ts` → IPC → `src/display/dom-frame.ts` in the renderer

OpenTUI keys: `src/ui/opentui-key.ts` only.

**Core vs config:** Commands in `src/core/commands.ts`; default keys in `src/config/default-bindings.ts`. Startup: `installDefaultConfig(editor)` from `src/config/index.ts`.

The evaluator uses dynamic `Function` (trusted config, like Elisp). In GUI, `eval` receives a minimal `Bun` shim from `runtimeBun()` when the real runtime is absent.
