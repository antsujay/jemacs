# plugins/

Each `<name>/index.ts` exports `install(editor: Editor): void | Promise<void>`. Loaded in order from `builtin.ts`.

Adding a plugin:
1. `plugins/<name>/index.ts` — `editor.command(...)`, `editor.key(...)`, `defineMinorMode(...)`, `addAdvice(...)`, `addHook(...)`.
2. `test/plugins/<name>.test.ts` — use `test/harness/` (`script()`, `keySeq()`, `fakeLspServer()`).
3. Register in `builtin.ts`.

State: `defvar(name, initial)` for globals (set-if-unbound, survives reload); `buffer.locals` for per-buffer; `WeakMap<Editor, T>` for per-editor (until PluginContext lands — DESIGN.md). No module-level `let`.

Hot reload: `C-c C-l` re-imports with cache-bust and calls `install` again. Idempotency is on you until PluginContext.
