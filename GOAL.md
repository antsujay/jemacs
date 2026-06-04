# GOAL.md — Emacs, reimplemented in JavaScript

**Jemacs is not an “Emacs-inspired” editor.** The goal is behavioral and architectural parity with GNU Emacs in TypeScript/JavaScript, with a replaceable terminal UI (OpenTUI today). Elisp becomes JS; buffers, windows, keymaps, commands, hooks, minibuffer, completion, and modes should feel like Emacs because they follow the same design.

This document is the contract: what exists today, what GNU Emacs still has that we do not, and how we close the gap in phases.

*Last audited: 2026-06-03.*

---

## North star

| GNU Emacs | Jemacs |
| --- | --- |
| Elisp | JavaScript / TypeScript (eval, plugins, modes, config) |
| C core + redisplay | `src/kernel/` (pure TS, testable) |
| Terminal / GUI frames | Pluggable frontends (`src/ui/opentui.ts` first) |
| `package.el` | Bun modules + `install(editor)` plugins |
| Decades of packages | Same extension model: hooks, modes, commands, advice |

**Success:** An experienced Emacs user can run `bun run dev` and work for a day without reaching for “real Emacs”—same keys, same concepts, same escape hatches (`M-x`, `C-h k`, `describe-variable`, Customize). Surprises are bugs; differences are documented.

**Non-goal:** Pixel-perfect GTK Emacs UI. **Goal:** behavioral and architectural parity.

**Primary editing target:** **Python** — port GNU `python.el` (`lisp/progmodes/python.el`), not a greenfield Python-ish mode.

---

## Audit: what exists today

Honest inventory of the current tree (`src/kernel/`, `src/init/`, `src/modes/`, `src/ui/opentui.ts`). See also [DEFAULT_KEYBINDINGS.md](DEFAULT_KEYBINDINGS.md).

### Working well (prototype strengths)

| Area | Status | Notes |
| --- | --- | --- |
| Buffer editing | **MVP+** | Insert/delete, movement, words, lines, read-only, dirty flag, simple undo/redo |
| Commands & `M-x` | **MVP+** | Large default command set; GNU names in `default-commands.ts` + `emacs-standard.ts` |
| Global keymap & prefixes | **MVP+** | `C-x`, `C-h`, `C-c`, `Esc`; `C-g` quits prefix, isearch, minibuffer |
| Keymap stack | **Partial** | `KeymapStack` + `activeKeymaps()`: overriding maps, minibuffer map + global, major-mode maps; **no minor modes** |
| Minibuffer | **Partial** | Real buffer per prompt; unified `handleKey()`; history; TAB completion; nested depth; global bindings in minibuffer (tested) |
| Kill / yank | **Partial** | Kill line/region/word, `yank-pop`, rectangle kill/yank; not full append-kill semantics |
| Isearch | **Basic** | `C-s` / `C-r`, forward/back, highlight; no regexp, `M-e`, or lazy highlight |
| Search / replace | **Basic** | `query-replace`, `replace-string`; no `query-replace-regexp`, occur |
| Files | **MVP** | `find-file`, `write-file`, `find-alternate-file`, `revert-buffer`, `save-buffer` |
| Dired | **Partial** | Mark, flag, copy, rename, delete, regexp marks; not wdired / full Emacs dired |
| Help | **Partial** | `describe-key`, `describe-bindings`, `describe-mode`, `describe-function`, `apropos-command`; `info` stub |
| Modes | **Partial** | `defineMode`, parent lineage, per-mode keymap, indent, tree-sitter font-lock, completion-at-point |
| Python | **Early** | Indent heuristics, defun nav, tree-sitter highlight; **not** `python.el` parity |
| Self-edit / runtime | **Strength** | `eval-region`, `eval-expression`, `load-plugin`, `reload-current-file`, inspect messages |
| Tests | **Good** | `bun test`: keymaps, minibuffer, isearch, dired, kernel behavior |

### Partial or broken (important gaps in current code)

| Area | Gap |
| --- | --- |
| **Windows** | `windowLayout` tree exists for per-window point/buffer, but `split-window-*` / `delete-window` still mutate a **getter** array (`windows.splice`) — splits do not update the tree; **OpenTUI draws one buffer only** (no multi-window redisplay) |
| **Input dispatch** | Printable keys fall through to `self-insert-command`; terminal keys bound in `src/config/default-bindings.ts` |
| **Prefix argument** | `C-u`, `M--`, digit args after `C-u` (e.g. `C-u 5`); not full Emacs digit-prefix stack |
| **Transient mark** | `markActive` exists; region highlighting and Emacs transient-mark-mode behavior incomplete |
| **Registers** | Point registers only; not full register types (text, rectangle, …) |
| **Macros** | Record command **names**, not key sequences — differs from Emacs keyboard macros |
| **Describe-variable** | Editor state snapshot, not real `defvar` / `defcustom` |
| **Package chords** | `magit`, `lsp`, `org`, etc. registered as **stubs** only |

---

## Audit: major features missing vs GNU Emacs

Grouped like the Emacs manual. **Missing** = not implemented or only a placeholder/stub. **Partial** = subset of Emacs behavior.

### Core editor

| Feature | Status |
| --- | --- |
| Multibyte / encoding / coding-system | **Missing** |
| Markers, narrowing, indirect buffers | **Missing** |
| Buffer-local variables (`setq-local`, `defvar`) | **Missing** |
| Undo boundaries, selective undo, undo in region | **Missing** (simple whole-buffer undo stack only) |
| Kill ring: append consecutive kills, rotate after yank | **Partial** |
| Interprogram paste (system clipboard integration) | **Partial** (macOS `pbcopy` command only) |
| Threads / async without blocking UI | **Missing** |

### Input, commands, minibuffer

| Feature | Status |
| --- | --- |
| Minor modes (global/local, mode-line lighter, toggle) | **Missing** |
| Sparse keymaps, `local-set-key`, full precedence spec | **Partial** |
| `interactive` spec forms (`P`, `r`, `b`, …) | **Missing** (args passed manually) |
| Full prefix argument (`C-u`, digits, `M--`) | **Partial** |
| Minibuffer: `M-x` in prompt, isearch in prompt, icomplete, `*Completions*` window selection | **Partial** |
| `completing-read` with annotations, partial completion, `C-M-i` | **Partial** |
| `abort-recursive-edit` / recursive edit parity | **Partial** |

### Search & motion

| Feature | Status |
| --- | --- |
| Regexp isearch, `M-e` edit, lazy highlight | **Missing** |
| `query-replace-regexp`, `replace-regexp` | **Missing** |
| Occur (`M-s o`), tags, project.el | **Missing** |
| `fill-paragraph`, `narrow-to-region` | **Missing** |

### Files & filesystem

| Feature | Status |
| --- | --- |
| Auto-save files | **Missing** |
| Backup files (`#file#`, `file~`) | **Missing** |
| `auto-mode-alist` / `magic-mode-alist` as data | **Partial** (hardcoded `inferMode`) |
| Tramp / remote files | **Missing** |
| `set-buffer-file-coding-system`, EOL conversion | **Missing** |
| wdired, full dired `%` commands | **Partial** |

### Windows & frames

| Feature | Status |
| --- | --- |
| Working split / `C-x 4` / dedicated windows | **Partial / broken** (see above) |
| `window-configuration` save-restore | **Missing** |
| `scroll-other-window`, horizontal scroll | **Missing** |
| Multiple frames, GUI frame backend | **Missing** |

### Display

| Feature | Status |
| --- | --- |
| Full mode line (`(percent)`, minor modes, process status) | **Partial** |
| Text properties / overlays (beyond font-lock spans) | **Missing** |
| Fringe, line numbers, git gutter minor mode | **Missing** |
| Multiple windows in redisplay | **Missing** |

### Lisp environment (JavaScript runtime)

| Feature | Status |
| --- | --- |
| `defvar`, `defcustom`, Customize UI | **Missing** |
| Hook system (`post-command-hook`, `after-save-hook`, …) | **Missing** (only per-mode `onEnter` hooks) |
| Advice (`:before` / `:after` / `:around`) | **Missing** |
| Load path, `require`, autoload | **Missing** |
| Optional Elisp compatibility | **Missing** (long-term) |

### Modes & packages

| Feature | Status |
| --- | --- |
| `define-derived-mode` equivalent | **Partial** (`parent` on `defineMode`) |
| Font-lock as incremental pipeline | **Partial** (tree-sitter / regex per buffer refresh) |
| `shell-mode`, `comint`, `compile` | **Missing** |
| `package.el` analog (install/activate/pin) | **Missing** |
| Built-in ports: full **python.el**, org, magit, eshell, ediff | **Missing** / stubs |
| LSP integration | **Stub** (`lsp-*` placeholders) |

### Help & documentation

| Feature | Status |
| --- | --- |
| Info reader (`C-h i`) | **Stub** |
| Tutorial / intro ported to JS | **Missing** |

### Famous third-party workflows (Emacs ecosystem)

| Package class | Status |
| --- | --- |
| Org-mode | **Missing** |
| Magit / git UI | **Stub** |
| Projectile / project switching | **Stub** |
| Gnus / notmuch mail | **Missing** |
| Eshell | **Missing** |
| Ediff | **Missing** |
| Ace jump, gptel, etc. | **Stub** or custom one-offs |

---

## Emacs subsystems checklist (target state)

Master matrix — everything below is **product**, not optional polish. Implementation order varies.

### Core editor

- [ ] Buffers — multibyte-safe text, markers, narrowing, indirect buffers, read-only, buffer-local variables
- [x] Buffers — basic text, visit, kill, list, switch *(MVP)*
- [ ] Windows — split, delete, other-window, dedicated windows, `window-configuration` save/restore
- [x] Windows — commands exist; tree + UI need to be finished *(partial)*
- [ ] Frames — terminal frame now; later GUI/web behind same abstraction
- [x] Point & mark — basic mark, exchange-point-and-mark *(partial transient mark)*
- [ ] Undo — undo-boundaries, selective undo, undo in region
- [x] Undo — linear undo/redo per buffer *(MVP)*
- [ ] Kill ring — append kill, full rotate-yank, interprogram paste
- [x] Kill ring — kill, yank, yank-pop *(partial)*
- [ ] Threads / concurrency — async subprocesses without blocking redisplay

### Input & commands

- [x] Unified key dispatch — keymap → commands; `self-insert-command` fallback for printables
- [x] Keymap stack — global, major, minibuffer, overriding *(no minor modes yet)*
- [x] Prefix keys — `C-x`, `C-c`, `C-h`, `Esc`; `C-g` quits
- [x] Commands — `M-x`, many interactive commands
- [ ] Commands — full `interactive` specs, `M--`, digit prefix args
- [x] Minibuffer — buffer, history, completion, nesting, global keys in prompt
- [ ] Minibuffer — full Emacs prompt behavior (icomplete, all maps per prompt type)
- [x] Completion — file + collection completing-read, `*Completions*` buffer
- [ ] Completion — icomplete, annotations, `C-M-i`, partial completion standards

### Search & motion

- [x] Isearch — forward/backward literal
- [ ] Isearch — regexp, lazy highlight, `M-e`, query-replace from search
- [x] Query replace — literal with prompts
- [ ] Occur, tags, project roots (+ LSP as **package**)

### Files & filesystem

- [x] Visit/save/revert/write-file
- [ ] Auto-save, backups, coding systems, Tramp
- [x] Dired — core directory editing *(partial vs full Emacs)*

### Display

- [x] Mode line, echo area, basic faces via theme + font-lock spans
- [ ] Full mode line, overlays, fringe, line numbers, multi-window redisplay

### Lisp environment (JS)

- [x] Evaluator — `eval-region`, `eval-expression`, plugins
- [ ] Load path, advice, `defcustom`, Customize
- [ ] Optional Elisp subset for porting

### Modes & packages

- [x] Major modes — several with tree-sitter / indent / keymaps
- [ ] Minor modes — toggle, lighter, buffer-local and global
- [ ] **python.el port** — see [Flagship mode](#flagship-mode-port-gnu-pythonel-to-javascript)
- [ ] Package manager, comint, compile, org, magit, eshell, ediff

### Help

- [x] `C-h k/c/b/f/v/a/e`, `help-for-help`
- [ ] Info manuals in buffer

---

## Where we are (summary)

| Subsystem | Status |
| --- | --- |
| Daily editing, buffers, global keys, `M-x` | Usable MVP |
| Keymap stack + minibuffer-as-buffer | **In progress** — landed, needs minor maps + less hardcoding |
| Major modes + tree-sitter | **Early** — many file types, shallow behavior |
| Windows in UI | **Not usable** — fix tree + redisplay before “daily driving” |
| Python (`python.el`) | **Not started** (heuristics only) |
| Hooks, customize, packages, comint | **Not started** |
| Self-edit / eval / plugins | **Strength** — keep and generalize |

---

## Phased roadmap

### Phase 0 — Foundation *(current)*

1. Fix **window tree** — `split-window-*`, `delete-window`, `other-window` update `windowLayout`; remove broken `windows.splice` paths.
2. **Multi-window redisplay** in OpenTUI (or document single-window until Phase 1).
3. Route **self-insert** and motion keys through commands/keymaps where feasible.
4. **Minor modes** + documented keymap precedence tests.
5. **`defvar` / buffer-local** skeleton; mode activation on `find-file`.

**Exit:** README bindings work in minibuffer; `C-h k` at prompt is correct; window split shows two buffers; `bun test` covers precedence.

### Phase 1 — Daily-driving editor + Python mode v1

- Port **`python.el`** (indent + nav + P0 keys) — [below](#flagship-mode-port-gnu-pythonel-to-javascript)
- Transient mark + region highlight; kill-ring append; undo boundaries
- Isearch regexp; `query-replace-regexp`
- Auto-save & backup files
- Dired polish; `~/.jemacs/init.ts` startup

**Exit:** Maintainer edits Python in Jemacs for two weeks (open, indent, navigate defs, search, save).

### Phase 2 — Emacs as a platform

- Hook system, advice, autoload, package manager
- `comint` / `shell-mode`, `compile`
- Info + full describe/customize
- Font-lock pipeline; tree-sitter as package option

**Exit:** Third-party package adds minor mode + hook without kernel edits.

### Phase 3 — Famous packages

- Org-mode (outline, src blocks)
- Magit-shaped git
- Tramp, Eshell, Ediff
- Optional Elisp bridge

### Phase 4 — Frontends & scale

- GUI/web frame sharing kernel
- Incremental redisplay; gap buffer or rope for large files

---

## Flagship mode: port GNU `python.el` to JavaScript

**Source of truth:** [GNU Emacs `lisp/progmodes/python.el`](https://github.com/emacs-mirror/emacs/blob/master/lisp/progmodes/python.el). Do **not** port legacy standalone `python-mode.el`.

**Target layout (when implementing):**

```
src/modes/python/
  SOURCE.md
  python-rx.ts
  python-indent.ts
  python-nav.ts
  python-shell.ts
  python-mode.ts
```

**Porting rules:** Same command names and `python-base-mode-map` keys where possible; behavior tests per subsystem; layers: indent → nav → shell → flymake/eldoc.

### P0 bindings (from upstream)

| Keys | Command |
| --- | --- |
| `TAB`, `BACKTAB` | `python-indent-line` / `python-indent-dedent-line` |
| `C-c <`, `C-c >` | `python-indent-shift-left` / `right` |
| `C-M-a`, `C-M-e`, `C-M-h` | `beginning-of-defun`, `end-of-defun`, `python-mark-defun` |

### Milestone: Python mode v1

- [ ] `.py` → `python-mode` with `#` comments
- [ ] Indentation parity (`test/python-indent.test.ts`)
- [ ] P0 keys on major-mode map stack
- [ ] `beginning-of-defun` / `end-of-defun` on `def` / `class` / `async def`
- [ ] README Python workflow section

**Do not expand python-mode until Phase 0 keymap + mode hooks are solid.**

### Defer from full `python.el`

| Feature | Plan |
| --- | --- |
| `python-ts-mode` | Package / Phase 2 |
| Pymacs, Python 2 paths | Omit |
| Tramp shell env | After Tramp |
| Full flymake / native completion | Phase 2; stub `python-check` early |

---

## Principle: the minibuffer is Emacs, not a dialog

The minibuffer must remain a **buffer** with the **full keymap hierarchy** (minibuffer-local + global; major/minor when Emacs would). Requirements:

- `M-x`, `C-w`, `C-s` in prompts where Emacs allows
- Nested prompts; `C-g` pops one level
- No parallel `handleMinibufferKey` shortcut that bypasses `handleKey()`

Today: largely met in kernel/tests; extend as new maps and commands land.

---

## Keymap precedence (spec)

Match GNU Emacs lookup order (extend as we add map types):

1. `overriding-terminal-local-map`
2. `overriding-map`
3. `minibuffer-local-map` (when in minibuffer)
4. Minor mode maps (reverse enable order) — **not implemented**
5. Major mode map
6. Buffer-local map
7. Global map

---

## API direction (JS “Lisp”)

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

- Behavior tests: key lookup order, minibuffer stack, undo boundaries, kill ring
- Regression: `C-x C-f` → `find-file` (or documented alias)
- Long-term: scriptable conformance scenarios

---

## What we keep from the prototype

- Live evaluation and reload-current-file
- Inspectable editor (`*messages*`, describe-*)
- Bun + OpenTUI as default stack

---

## Metrics

| Milestone | Metric |
| --- | --- |
| Phase 0 done | README bindings in minibuffer; window split visible; map precedence in `bun test` |
| Phase 1 done | Full-time **Python** editing in Jemacs for 2 weeks |
| Python mode v1 | Indent + defun tests; P0 `python-base-mode-map` keys |
| Phase 2 done | ≥3 packages without kernel edits |
| Phase 3 done | Org + git workflow documented |
| “Emacs in JS” | Newcomer recognizes GNU Emacs Manual part I architecture |

---

## Immediate next steps

1. Fix window split/delete to use `windowLayout`; render multiple windows in OpenTUI.
2. Add **minor modes** to `activeKeymaps()` + tests.
3. Introduce `defvar` / buffer-local variables; wire `describe-variable`.
4. **`prog-mode` + `python-mode` skeleton** on mode hooks only — then begin `python-rx` + `python-indent` + tests.

---

## Open design decisions

1. Byte-compiled / cached eval for startup?
2. Gap buffer vs rope for large buffers?
3. Elisp bridge: transpile vs embed vs JS-only ports?
4. LSP: core vs package (**recommend: package**).

---

*Trim scope only by explicit maintainer decision recorded here—not by accident.*
