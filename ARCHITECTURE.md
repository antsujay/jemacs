# Architecture

State of the codebase as of the 17-plugin landing. Updated after each tech-lead review pass. See DESIGN.md for the target end-state (core/lisp split, hot reload).

## Layers

```
┌─────────────────────────────────────────────────────────┐
│ ui/          OpenTUI host  ·  Electron host             │
├─────────────────────────────────────────────────────────┤
│ display/     buildDisplayModel : Editor → DisplayModel  │
├─────────────────────────────────────────────────────────┤
│ kernel/      Editor · BufferModel · Keymap · WindowTree │
│ runtime/     evaluator · defcustom · advice · hooks     │
├─────────────────────────────────────────────────────────┤
│ core/ modes/ config/   commands · modes · bindings      │  ← to become lisp/
│ plugins/               17 builtins                      │
│ lsp/                   eglot-style thin client          │
└─────────────────────────────────────────────────────────┘
```

`display/` is the seam: everything above it is host-specific rendering; everything below is pure state + logic. A new host implements `UiHost` and consumes `DisplayModel` — no kernel changes.

## Invariants

- `BufferModel.text` is the single source of truth; `point`/`mark` are indices into it; `0 ≤ point ≤ text.length` always.
- `Editor.handleKey` is the only entry point for input. Commands run via `editor.run(name)` which goes through advice + records for macros.
- Keymaps resolve in order: overriding-terminal-local → overriding → minor-mode → major-mode lineage → global.
- `buildDisplayModel` is pure (no side effects on `editor`).

## Known violations (tracked in TODO.md)

- `point > text.length` reachable via goto-line.
- Mark not adjusted on edits before it.
- Several mutation paths skip `onTextChange` → LSP desync.
- Module-level mutable state (`killRingHistory`, isearch `regexpMode`) — should be `defvar` or per-editor.

## Review log

| date | reviewer | findings | action |
|---|---|---|---|
| 06-04 | initial hunt | 23 bugs; LSP sync cluster is the worst; keymap normalization is the most user-visible | all 24 fixed (`ad06002`) |
| 06-05 | tech-lead pass | (1) `defvar` overwrites — DESIGN.md hot-reload assumed set-if-unbound, `custom.ts:22` doesn't do that. (2) 11 kernel→upward imports. (3) 4 plugins string-match `changed.reason` as a fake `post-command-hook`. (4) Singleton registries vs `WeakMap<Editor,T>` makes tests non-hermetic. | (1) round-2. (3) fire `post-command-hook` from `editor.run()` — sequenced before PluginContext (deletes ~80 lines of plugin hacks). |
| 06-05 | live dogfood | OpenTUI ESC-prefix not decoded as Meta; motion was deactivating mark; bug-20 fix hid cursor at EOL | `bf4c221` |
| 06-05 | deep-review (6 perspectives + architect) | 46 findings (7 crit). **Architect: REFACTOR `BufferModel._splice`** — private `_text` + one mutation funnel closes 9/46 incl. 3 critical. Also: 3 plugins reach into private windowLayout; Keymap has dead parallel pending state; 18 Editor methods are 1:1 command wrappers. | `do_not_commit/deep-review.md`; `_splice` is next TODO |

