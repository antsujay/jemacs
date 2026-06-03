# GOAL.md — Emacs, reimplemented in JavaScript

**Jemacs is not an “Emacs-inspired” editor.** The goal is a faithful reimplementation of GNU Emacs’s architecture and behavior in modern JavaScript/TypeScript, with a replaceable terminal UI (OpenTUI today). Elisp becomes JS; the rest of the editor—buffers, windows, keymaps, commands, hooks, minibuffer, completion, modes, packages—should feel like Emacs because it **is** the same design, ported.

This repo is early. The sections below describe **where we are**, **what “done” means**, and **how to get there** in phases. Ship vertical slices; do not water down the end state.

---

## North star

| GNU Emacs | Jemacs |
| --- | --- |
| Elisp | JavaScript / TypeScript (eval, plugins, modes, config) |
| C core + redisplay | `src/kernel/` (pure TS, testable) |
| Terminal / GUI frames | Pluggable frontends (`src/ui/opentui.ts` first) |
| `package.el` | Bun modules + `install(editor)` plugins |
| Decades of packages | Same extension model: hooks, modes, commands, advice |

**Success:** An experienced Emacs user can sit down, run `bun run dev`, and work for a day without reaching for “real Emacs”—same keys, same concepts, same escape hatches (`M-x`, `C-h k`, `C-h f`, `describe-variable`, `customize`). Differences are documented; surprises are bugs.

**Non-goal:** Pixel-perfect UI clone of GTK Emacs. **Goal:** behavioral and architectural parity.

**Primary editing target:** **Python.** The first real major mode is a port of GNU Emacs’s built-in `python-mode` (from `lisp/progmodes/python.el`), not a greenfield “Python-ish” mode. Jemacs should be excellent for editing `.py` files before we polish other language modes.

---

## Emacs subsystems (target checklist)

Treat this as the master feature matrix. Nothing here is “nice to have”; it is **the product**. Order of implementation varies; completeness does not.

### Core editor (the C layer, in TS)

- [ ] **Buffers** — multibyte-safe text, markers, narrowing, indirect buffers, read-only, buffer-local variables
- [ ] **Windows** — split, delete, other-window, dedicated windows, `window-configuration` save/restore
- [ ] **Frames** — terminal frame now; later GUI frame backend behind same abstraction
- [ ] **Point & mark** — transient mark, region-active-p, exchange-point-and-mark
- [ ] **Undo** — undo-boundaries, selective undo, undo in region
- [ ] **Kill ring** — append kill, rotate-yank, interprogram paste
- [ ] **Threads / concurrency** — async subprocesses without blocking redisplay (later)

### Input & commands

- [ ] **Unified key dispatch** — one code path for minibuffer, main area, and read-only special buffers
- [ ] **Keymap stack** — `overriding-terminal-local-map`, `minibuffer-local-map`, minor modes, major mode, global; `define-key`, `local-set-key`, sparse keymaps
- [ ] **Prefix keys** — `C-x`, `C-c`, `C-h`, `ESC` as prefix; `C-g` quits prefix and minibuffer
- [ ] **Commands** — `interactive` specs, prefix args (`C-u`, `M--`), `M-x`, `repeat`, `execute-extended-command`
- [ ] **Minibuffer** — real buffer, recursive edit, **all relevant keymaps active** (global + minibuffer + completion), history, completion, `minibuffer-depth-indication-mode`
- [ ] **Completion** — `completing-read`, `*Completions*`, icomplete, partial completion, `C-M-i`

### Search & motion

- [ ] **Isearch** — `C-s` / `C-r`, regexp, lazy highlight, `M-e` edit, `M-%` query-replace from search
- [ ] **Query replace** — `M-%`, regexp variant
- [ ] **Occur** — `M-s o`, `C-x C-o` in `*Occur*`
- [ ] **Tags / project** — etags, project.el-style roots (JS ecosystem: LSP integration as a *package*, not core)

### Files & filesystem

- [ ] **Visit/save** — auto-save, backups (`#file#`, `file~`), `C-x C-w`, revert-buffer
- [ ] **Dired** — directory editing, flags, `q`, `g`, `^`, wdired
- [ ] **Tramp** — remote paths (phase: pluggable `file-name-handler` alist equivalent)
- [ ] **Encoding & EOL** — `set-buffer-file-coding-system`, detect coding systems

### Display

- [ ] **Mode line** — full format: buffer, mode, line/col, `(percent)`, minor modes, pending prefix
- [ ] **Echo area** — messages, `C-h e` view-echo-area-messages
- [ ] **Faces & text properties** — syntax highlight via overlays/properties; font-lock equivalent in JS
- [ ] **Fringe / margin** — line numbers, git gutter (as minor mode)
- [ ] **Scroll** — recenter, scroll-other-window, horizontal scroll where needed

### Lisp environment (JS)

- [ ] **Evaluator** — `eval`, `eval-region`, `eval-defun`, `eval-buffer`, lexical scope option
- [ ] **Load path** — `require`, autoload, `load`, `load-library`, after-load hooks
- [ ] **Advice** — `:around` / `:before` / `:after` on commands and functions
- [ ] **Macros & defcustom** — `defvar`, `defcustom`, `setq-default`, Customize UI
- [ ] **Optional Elisp subset** — transpile or embed for package porting (long-term; not blocking v1)

### Modes & packages

- [ ] **Major modes** — derived modes, mode hooks, `define-derived-mode` equivalent
- [ ] **Minor modes** — toggle, mode line lighter, buffer-local and global
- [ ] **Font-lock / syntax** — per-mode rules; tree-sitter bridge as package
- [ ] **Shipped modes** — **`python-mode` first** (see below), then `prog-mode`, `text-mode`, `js-mode`, `typescript-mode`, `markdown-mode`, `json-mode`, `dired-mode`, `shell-mode`, `comint`
- [ ] **Package manager** — install from git/npm, pin versions, autoloads on startup

### Help & discovery

- [ ] **C-h k** — describe-key (which map, which command)
- [ ] **C-h f** — describe-function/command
- [ ] **C-h v** — describe-variable
- [ ] **C-h m** — describe-mode
- [ ] **C-h b** — list buffers (already partial)
- [ ] **Info** — read Info manuals in buffer (Emacs tutorial, elisp intro → JS port docs)

### Classic packages (built-in or first-party)

- [ ] **Org** — outline, agenda, source blocks (ambitious; separate milestone)
- [ ] **Magit-shaped git** — status, commit, blame as minor modes
- [ ] **Gnus/notmuch-shaped mail** — optional
- [ ] **Eshell** — Lispy shell on JS runtime
- [ ] **Ediff** — 2/3-way merge UI in windows

---

## Flagship mode: port GNU `python.el` to JavaScript

**Source of truth:** [GNU Emacs `lisp/progmodes/python.el`](https://github.com/emacs-mirror/emacs/blob/master/lisp/progmodes/python.el) (maintained in Emacs; ~7k lines Elisp). Do **not** port the legacy standalone `python-mode.el` package (different project, huge and divergent).

**Target layout in this repo (when we implement):**

```
src/modes/python/
  SOURCE.md          # upstream path, version, license, porting notes
  python-rx.ts       # from `python-rx` macro (block-start, defun, dedenter, …)
  python-indent.ts   # `python-indent-*`, `python-indent-context`
  python-nav.ts        # `python-nav-*`, `python-mark-defun`
  python-shell.ts    # `python-shell-*`, `run-python`, inferior buffer (later)
  python-mode.ts       # `define-derived-mode` equivalent: install commands + keymap
```

**Porting rules**

1. **Same command names** as Emacs where possible (`python-indent-line`, `python-shell-send-buffer`, `beginning-of-defun`, …).
2. **Same keymap** as `python-base-mode-map` / `python-mode-map` unless the kernel cannot represent a key yet—then document the gap in `SOURCE.md`.
3. **Behavior tests** per subsystem (indent fixtures copied from Emacs comments or small `.py` snippets).
4. Port in **layers**: indentation + movement first, then shell/comint, then flymake/eldoc/imports—matching how Emacs splits concerns inside one file.

### `python-base-mode-map` bindings to honor (from upstream)

| Keys | Command | Priority |
| --- | --- | --- |
| `TAB`, `BACKTAB` | `python-indent-line` / `python-indent-dedent-line` | P0 |
| `C-c <`, `C-c >` | `python-indent-shift-left` / `right` | P0 |
| `C-M-a`, `C-M-e`, `C-M-h` | `beginning-of-defun`, `end-of-defun`, `python-mark-defun` | P0 |
| `C-c C-j` | `imenu` | P1 |
| `C-c C-p` | `run-python` | P1 |
| `C-c C-c`, `C-c C-l`, `C-c C-z`, … | `python-shell-send-*`, `python-shell-switch-to-shell` | P1 (needs comint) |
| `C-c C-v`, `C-c C-f`, `C-c C-d` | `python-check`, `python-eldoc-at-point`, `python-describe-at-point` | P2 |
| `C-c C-i …` | import add/remove/sort/fix | P2 |
| `C-c C-t …` | skeletons | P3 |

Movement remaps (`M-a`/`M-e` → block nav, etc.) come after `python-nav-*` exists.

### Indentation (largest port)

Reimplement the pipeline from `python.el`, not a simplified tab handler:

- `python-indent-offset` (default 4), `python-indent-guess-indent-offset`
- `python-indent-context` → `python-indent--calculate-indentation` → `python-indent-line`
- `python-indent-dedent-line`, `python-indent-region`, shift left/right
- Electric `:` behavior (`python-indent-post-self-insert-function`) once `post-self-insert-hook` exists

Acceptance: open a multi-level `.py` file, `TAB` at line start cycles indent levels like Emacs; `elif`/`else` dedent correctly; continuations after `\` align.

### Shell & evaluation (Python-specific)

- `run-python` → `*Python*` buffer (comint-style)
- `python-shell-send-buffer`, `-region`, `-defun`, `-file`, `-statement`
- `python-interpreter` / `python-shell-interpreter` as `defcustom` equivalents
- Integrate with Jemacs eval story only where Emacs does (do not replace `python-shell-send-*` with ad-hoc `eval` for normal use)

### Mode entry

- `inferMode` / `auto-mode-alist`: `\.py[iw]?$` → `python-mode`
- `python-mode` derived from `prog-mode` (port `prog-mode` minimal keymap or inherit global prog bindings)
- **Minibuffer:** `python-mode` keys that apply in Emacs during Python-related prompts must work once unified key dispatch lands (see minibuffer section).

### What we skip or defer from full `python.el`

| Feature | Plan |
| --- | --- |
| `python-ts-mode` (tree-sitter) | Package / Phase 2; start with regex + `python-rx` like classic `python-mode` |
| Pymacs, legacy Python 2-only paths | Omit |
| Tramp-specific shell env | After Tramp |
| Full flymake / native completion | Phase 2; stub `python-check` with `python -m py_compile` or `ruff` early |

### Milestone: “Python mode v1”

- [ ] `.py` files open in `python-mode` with correct comment syntax (`# `)
- [ ] Indentation parity on a fixed test corpus (checked in `test/python-indent.test.ts`)
- [ ] `python-base-mode-map` P0 keys bound via major-mode keymap stack
- [ ] `beginning-of-defun` / `end-of-defun` on `def`/`class`/`async def`
- [ ] README section: Python workflow (edit, indent, send to shell when comint exists)

**Do not implement python-mode until Phase 0 keymap stack + mode hooks exist**—otherwise bindings fight the global map and minibuffer stays broken.

---

## Principle: the minibuffer is Emacs, not a dialog

Today (`src/ui/opentui.ts`) the minibuffer is a special-case input handler: almost no keybindings. **That is incompatible with the project goal.**

In GNU Emacs:

- The minibuffer is a **buffer** (`minibuffer-mode`).
- Key lookup walks the same **keymap hierarchy** (with `minibuffer-local-map` and friends on top).
- **Global bindings work** unless shadowed. Major/minor maps apply where Emacs applies them (e.g. `minibuffer-with-setup-hook` for `M-x` vs `find-file`).
- You can **`M-x` inside a prompt**, **`C-w` in the prompt**, **`C-s` in the prompt** (for history or completion), nest prompts, and **`C-g` one level at a time**.

**Requirement:** `editor.handleKey()` must not branch “if minibuffer then ignore keymap.” Minibuffer edits go through `BufferModel` (or equivalent) and the full dispatcher.

---

## Architecture (target)

```
                    ┌─────────────────────────────────────┐
                    │  Frontend (OpenTUI, later GUI/web)   │
                    │  keys, paste, resize, draw strings   │
                    └─────────────────┬───────────────────┘
                                      │ handleKey / render
                    ┌─────────────────▼───────────────────┐
                    │  Kernel (no UI imports)              │
                    │  Editor, Frame, Window, Buffer       │
                    │  Keymaps, Commands, Minibuffer       │
                    │  Completion, Hooks, Variables        │
                    └─────────────────┬───────────────────┘
                                      │
                    ┌─────────────────▼───────────────────┐
                    │  Runtime (JS “Lisp”)                 │
                    │  eval, load, advice, packages        │
                    └─────────────────────────────────────┘
```

**Rules**

1. Kernel stays UI-agnostic (`AGENTS.md`).
2. Every user-visible action is a **command** reachable from `M-x` and bindable in a keymap.
3. Prefer **reimplementing Emacs names** (`find-file`, `switch-to-buffer`, `kill-line`) over inventing new ones.
4. Tests lock behavior: key lookup order, minibuffer nesting, undo boundaries.

---

## Where we are (honest baseline)

| Subsystem | Status |
| --- | --- |
| Buffers, point, mark, region, basic kill/yank | MVP |
| Global keymap + prefixes | MVP |
| Commands, `M-x`, messages | MVP |
| Minibuffer | **Broken vs Emacs** — parallel input path |
| Modes | Labels only — no keymaps, hooks, or font-lock |
| Windows / frames | Single view |
| Isearch, dired, completion, hooks, customize | Not started |
| Self-edit / eval / plugins | **Strength** — keep and generalize |

---

## Phased roadmap (ambitious, ordered)

### Phase 0 — Foundation (current sprint)

Make the kernel behave like Emacs’s input layer, not a text widget.

1. **`src/kernel/input.ts`** — single `handleKey(editor, event)`; UI only forwards events.
2. **Keymap stack** — global, major, minor, local, minibuffer-*, overriding maps; `describe-key` shows winner.
3. **Minibuffer = buffer** — unified dispatch; history + TAB completion; recursive prompts.
4. **Buffer-local variables & mode hooks** — `enable-javascript-mode` style activation on `open-file`.

**Exit criteria:** README keybindings work in the minibuffer; `C-h k` at prompt reports correct binding; nested `prompt` + `C-g` passes tests.

### Phase 1 — Daily-driving editor + Python mode v1

- **Port `python.el`** (indent + nav + P0 keys) — see [Flagship mode](#flagship-mode-port-gnu-pythonel-to-javascript)
- Full **kill ring**, **undo** ergonomics, **transient mark** + region highlight
- **Isearch** + **query-replace**
- **Windows** (`C-x 2`, `1`, `0`, `o`, `4`) and **window-selected buffer**
- **Dired**
- **Auto-save** & **backup files**
- **`defcustom` + `~/.jemacs/init.ts`** startup file

**Exit criteria:** You can edit Python projects in Jemacs for a week (open, indent, navigate defs, search, save); shell send works once comint lands in Phase 1b or early Phase 2.

### Phase 2 — Emacs as a platform

- **Hook system** — `post-command-hook`, `after-save-hook`, `kill-emacs-hook`, mode hooks
- **Advice** and **autoload**
- **Package.el analog** — install/activate/list packages
- **Completion subsystem** — generic `completing-read`, annotation buffer, icomplete
- **Help system** — Info, apropos, describe-* parity
- **Font-lock** pipeline + tree-sitter package
- **Subprocess / comint** — `M-!`, `async-shell-command`, compile mode

**Exit criteria:** Third-party package can add a minor mode with keymap + hook without forking kernel.

### Phase 3 — Famous packages

- **Org-mode** (outline, TAB cycling, src blocks, export hooks)
- **Magit** or equivalent
- **Tramp** / remote files
- **Eshell**
- **Ediff**
- Optional **Elisp** compatibility layer for porting old config

**Exit criteria:** Documented port of a non-trivial Emacs config section (e.g. org + magit workflow) with JS equivalents listed in a migration guide.

### Phase 4 — Frontends & scale

- GUI or web frame backend sharing kernel
- Performance: redisplay incremental, buffer gap buffer or rope if needed
- Large files, many windows, long-running sessions

---

## Keymap precedence (spec)

Match GNU Emacs’s lookup order (simplified; extend as we add map types):

1. `overriding-terminal-local-map` (if active)
2. `overriding-map` (if active)
3. `minibuffer-local-ns-map` / `minibuffer-local-map` (when in minibuffer)
4. Minor mode maps (reverse order of enablement)
5. Major mode map
6. Buffer-local map (if any)
7. Global map

**Minibuffer rule:** Never bypass this stack. “Major mode keybinds in minibuffer” means: apply the same rules Emacs applies (global always; major/minor when Emacs would—document per prompt type in tests).

---

## API direction (JS “Lisp”)

Aim for Emacs-shaped public API on `Editor`:

```ts
editor.defun("my-command", async (ctx) => { ... }, { interactive: true })
editor.defvar("my-flag", false, { doc: "...", type: "boolean" })
editor.defcustom("my-option", 80, { ... })
editor.defineKey("global", "C-c C-x", "my-command")
editor.defineMode({ name: "typescript-mode", parent: "prog-mode", keymap, hooks })
editor.addHook("after-save-hook", () => ...)
editor.completingRead("Find file: ", { collection: files, history: "file" })
```

Plugins and `~/.jemacs/init.ts` use the same surface as built-in code.

---

## Testing philosophy

- **Behavior tests over snapshots** — key lookup, minibuffer stack, undo boundaries, kill ring rotation
- **Regression tests for Emacs names** — binding `C-x C-f` must always call `find-file` (or documented alias)
- **Conformance suite (long-term)** — scriptable scenarios: “open file → isearch → query-replace → save” with expected buffer state

---

## What we keep from the prototype

- **Live evaluation** and **reload current file** — first-class, not a demo trick
- **Inspectable editor** — `C-h e` on live objects; becomes `describe` family
- **Bun + OpenTUI** — default stack; not the only allowed stack

---

## Metrics (project-level)

| Milestone | Metric |
| --- | --- |
| Phase 0 done | 100% of README bindings pass in minibuffer; `bun test` covers map precedence |
| Phase 1 done | Maintainer uses Jemacs full-time for **Python** work for 2 weeks |
| Python mode v1 | Indent + defun navigation tests pass; P0 `python-base-mode-map` keys work in `.py` buffers |
| Phase 2 done | ≥3 external packages (or monorepo packages) without kernel edits |
| Phase 3 done | Org + git workflow documented end-to-end |
| “Emacs in JS” | A newcomer recognizes architecture from *GNU Emacs Manual* part I |

---

## Open design decisions (resolve in code + tests)

1. **Byte-compiled JS** — cache eval for startup speed?
2. **Gap buffer vs rope** — when buffers exceed ~1MB?
3. **Elisp bridge** — transpile vs embed vs “rewrite in JS” only?
4. **LSP** — core vs `lsp-mode` package (recommend: package).

---

## Immediate next steps (from today’s tree)

1. Extract key handling to kernel; delete `handleMinibufferKey` shortcut.
2. Implement keymap stack + `describe-key`.
3. Minibuffer buffer + completion + history + recursion.
4. **`prog-mode` + `python-mode` skeleton** — mode hooks and empty major map only; no indent yet.
5. **Begin `python.el` port** — `python-rx` + `python-indent-context` + tests (after step 2).

Do **not** land a partial python-mode in the tree before step 2; document and test the port in GOAL-driven slices.

---

*This document is the contract: Jemacs is Emacs in JavaScript. Trim scope only by explicit maintainer decision, recorded here with reason—not by accident.*

*Last updated: 2026-06-03.*
