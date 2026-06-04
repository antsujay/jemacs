# AGENTS.md

## Workflow

- Prefer small, focused changes that match the existing TypeScript style.
- Run `bun run check` and `bun test` after code changes when possible.
- If `bun` is not on `PATH`, use `npx bun run check` and `npx bun test`.
- After a feature or Emacs port, commit when the user asks (see user rules for git safety).
- Roadmap and checkboxes: [PLAN.md](PLAN.md).

## Emacs fidelity

When porting or replicating a GNU Emacs interactive function:

- **Name:** Register the command under the same GNU name (kebab-case, e.g. `beginning-of-buffer`). Do not invent Jemacs-specific command names unless Emacs has no equivalent.
- **Behavior:** Match Emacs semantics; check `lisp/` or the manual when unsure.
- **Key:** Wire defaults in `src/config/default-bindings.ts` (or `~/.jemacs/init.ts`) via `editor.key` / `editor.defineKey` — never hardcode in `handleKey()`. Commands live in `src/core/`. See [DEFAULT_KEYBINDINGS.md](DEFAULT_KEYBINDINGS.md).
- **TypeScript identifiers:** Hyphenated Emacs names → camelCase helpers; the public command string stays kebab-case.

## Two runtimes (important)

| Entry | Runtime | Bootstrap |
| --- | --- | --- |
| `src/main.ts` | **Bun** | `runJemacs(editor, host)` — TUI attaches OpenTUI input after `runJemacsCore` |
| `src/main-electron.ts` | **Electron / Node** | `runJemacsCore` only — do not import `run.ts` if that pulls OpenTUI into the bundle |

**Rule:** Anything bundled into `dist/main-electron.js` must work without `Bun`. Use `src/platform/runtime.ts` for files, `which`, and subprocesses. Pass `runtimeBun()` into the evaluator for `M-x eval`, not the global `Bun`.

## UI hosts

### Shared (display-agnostic)

- Kernel: `src/kernel/` — no `@opentui/*`, no `electron`, no DOM.
- Redisplay: `src/display/build-display-model.ts` → `DisplayModel` (`protocol.ts`, `ThemedText`, `serialize.ts`).
- Wiring: `bindJemacsHost` / `runJemacsCore` in `src/run-core.ts`.
- Tests: `test/build-display-model.test.ts`, `test/bind-jemacs.test.ts`, `test/smoke-windows.test.ts`.

### Terminal — `OpenTuiHost`

- `src/ui/opentui-host.ts`, `src/ui/opentui-key.ts`, `src/ui/opentui-styled.ts`.
- Input attached via `src/ui/attach-opentui.ts` (dynamic import from `run.ts` so Electron main does not bundle `@opentui/core`).
- Tests: `test/opentui-host.test.ts`, `test/mouse-click.test.ts`, `test/textarea-host.test.ts`.
- Optional: `JEMACS_USE_TEXTAREA=1` — `opentui-textarea-sync.ts` applies font-lock to `editBuffer` highlights.

### GUI — `ElectronHost`

- Main: `src/ui/electron-host.ts`, entry `src/main-electron.ts`.
- Renderer: `src/electron/renderer.ts` + `src/display/dom-frame.ts` (shared DOM paint).
- Preload: `src/electron/preload.ts` → must build as **CJS** (`scripts/build-electron.ts`, `format: "cjs"`).
- IPC: `jemacs:display` (main → renderer), `jemacs:input` / `jemacs:ready` (renderer → main). Main caches the last frame and re-sends on `jemacs:ready` so the first paint is not lost.
- Assets: `dist/electron/` (html, css, js); main at `dist/main-electron.js`. `electronDistDir()` → `path.join(import.meta.dirname, "electron")` next to the bundled main.

**Electron build (`scripts/build-electron.ts`):**

- **External** (do not bundle): `electron`, `@opentui/core`, all `tree-sitter*` packages — bundling tree-sitter breaks font-lock silently in GUI.
- Preload: CJS + `external: ["electron"]`.
- Renderer: ESM browser bundle.

**Scripts:**

- `bun run dev:gui` — build + `npx electron dist/main-electron.js`
- `bun run smoke:gui` — automated GUI smoke (`--smoke-gui`: open-file, font-lock spans, splits)
- `bun run preview:gui` — static browser preview of DOM frame (no IPC)

**Tests:** `test/electron-preload.test.ts`, `test/platform-runtime.test.ts`, `test/smoke-commands.test.ts`.

## Workspace packages

`packages/jemacs-core`, `packages/host-opentui`, `packages/host-electron` are thin re-exports for organization; **do not** move the app entrypoint without updating build paths. See `packages/README.md`.

## Adding features safely

1. **Buffer / command logic** — `src/kernel/`, `src/core/` (runtime-agnostic).
2. **Visuals** — extend `build-display-model.ts` or `buffer-view.ts`, not host-specific hacks.
3. **New host behavior** — implement `UiHost` in `protocol.ts`, keep painting out of the kernel.
4. **GUI-only I/O** — `platform/runtime.ts`, never raw `Bun.file` / `Bun.spawn` in shared code paths.
5. After Electron-touching changes: `bun run build:gui && bun run smoke:gui`.

## Lisp environment (partial)

- `src/runtime/custom.ts` — `defcustom` / `defvar`
- `src/runtime/load-path.ts` — plugin resolution in `Evaluator`
- `src/runtime/advice.ts` — `invokeWithAdvice` in `Editor.run`
- `src/runtime/interactive.ts` — minimal `(s)` / `(b)` interactive forms
