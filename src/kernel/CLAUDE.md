# src/kernel/

The "C core" — state holders + dispatch. Target: defines no commands (DESIGN.md).

| file | what | invariants |
|---|---|---|
| `editor.ts` | `Editor` — buffers map, keymap stack, `handleKey`/`run` dispatch, window tree, minibuffer request | the only entry for input is `handleKey`; commands run via `run()` (advice + macro recording) |
| `buffer.ts` | `BufferModel` — text, point, mark, locals, undo | `0 ≤ point ≤ text.length`; edits fire `onTextChange` and `deactivateMark`; motion does NOT deactivate |
| `keymap.ts` | `Keymap`, `KeymapStack`, `keyToken`, `normalizeToken` | lookup order: overriding-terminal-local → overriding → minor → major lineage → global |
| `window.ts` | `WindowNode` tree, split/delete/find leaf | binary tree; every leaf has a bufferId |
| `isearch.ts` | `findForward`/`findBackward`, `IsearchState` | pure search; the UI loop lives in editor.ts (and will move to lisp/) |
| `command.ts` | `CommandRegistry` | commands keyed by name; `restore`/`restoreAll` for hot-reload |
| `hooks.ts`, `prefix-argument.ts`, `register.ts`, `transient-mark.ts` | small primitives | |

Extend by adding a primitive method on `Editor`/`BufferModel` ONLY if a plugin can't do it via advice/hooks/locals. Otherwise put the behavior in `plugins/` or (per DESIGN.md) `lisp/`.
