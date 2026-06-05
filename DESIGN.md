# Design: core/config split and hot reload

Two questions from Stephen, both answered by the same architectural move.

## Core vs. lisp (the config split)

### What Emacs actually does

Emacs's C core is ~1500 primitives: buffer-gap text, redisplay, keymap *lookup* (not bindings), subprocess, the bytecode VM. It defines no commands. `next-line`, `find-file`, `save-buffer` are Lisp, in `simple.el`/`files.el`, loaded by `loadup.el` and dumped into the image. There is no "core config" vs "user config" distinction at the language level — `site-start.el`, packages, `init.el` all just `(load)` and call the same primitives. The C core is small and stable; everything else is hot-reloadable Lisp.

The extension surface that makes this work:

| abstraction | what it lets a package do | jemacs status |
|---|---|---|
| hooks | run at well-known points | infra exists; only 2 fire |
| advice | wrap/replace any named function | before/after only; no `:around`/`:override` |
| keymaps | layer bindings without touching others' maps | ✅ chain exists |
| `defvar`/`defcustom` | introduce state that survives reload | ✅ but underused (state is in closures) |
| buffer-local variables | per-buffer state without subclassing Buffer | `buffer.locals` Map exists, no `make-variable-buffer-local` |
| `cl-defgeneric` | per-mode behavior a third party can extend | `Mode` fields (closed); no open dispatch |
| features/`provide`/`require` | dependency ordering + `unload-feature` | none |

### What jemacs does today

`Editor` is a 1000-line class holding both the primitives (buffer map, keymap dispatch, window tree) *and* high-level behavior (`recenterTopBottom`, `scrollScreen`, the isearch driver, `completingRead` UI). `src/core/commands.ts` is a privileged blob with module-private closures (`killRingHistory`). `src/config/user.ts` is Stephen's prefs hardcoded into the boot path.

### Proposed split

```
src/kernel/      "C core" — state holders + dispatch. Defines no commands.
  editor.ts      buffers map, keymap stack, handleKey loop, window tree,
                 minibuffer request/resolve, prompt primitive, runHook.
                 Target: <400 lines.
  buffer.ts, keymap.ts, window.ts, hooks.ts, isearch.ts (search primitive only)
src/runtime/     evaluator, defcustom/defvar, advice, source tracking  (unchanged)
src/display/     DisplayModel, UiHost protocol                         (unchanged)
lisp/            preloaded "packages" — each exports install(editor, ctx)
  simple.ts      motion, kill-ring, transpose, mark commands
  files.ts       find-file, save-buffer, revert-buffer, dired entry
  window-cmds.ts split/delete/other-window, recenter, scroll
  minibuf.ts     completing-read default UI (the *Completions* buffer)
  isearch-ui.ts  the isearch command loop (kernel keeps findForward primitive)
  loadup.ts      ordered list of the above
plugins/         optional packages (the 17 we just built)
~/.jemacs/init.ts  user config — same contract
```

Boot: `new Editor()` → `loadup.ts` → `plugins/builtin.ts` → `~/.jemacs/init.ts`. Everything after `new Editor()` is the same `install(editor, ctx)` contract.

Migration is mechanical: take each method on `Editor` that's reachable from a keybinding and move it into a `lisp/*.ts` command that calls only kernel primitives. `recenterTopBottom` becomes a command in `lisp/window-cmds.ts` that reads `editor.selectedWindowLeaf()` and calls `setWindowLeafStartLine()`.

### Extension-point work to make plugins first-class

- Fire the standard hooks: `pre-command-hook`, `post-command-hook`, `before-save-hook`, `after-save-hook`, `kill-buffer-hook`, `buffer-list-update-hook`, `window-configuration-change-hook`, `minibuffer-setup-hook`, `minibuffer-exit-hook`. The save-hooks plugin does this via advice; once it's in `lisp/files.ts` it's just `await editor.runHook(...)` at the right line.
- Advice gains `:around` and `:override` so a plugin can replace a command without redefining it (and without losing the original on un-advice).
- `defgeneric(name)` / `defmethod(name, mode, fn)` for open per-mode dispatch (`indent-line`, `complete-at-point`, `beginning-of-defun`). Replaces the closed `Mode.completeAtPoint` field.
- `provide(feature)` / `require(feature)` so plugins can declare deps and `unload-feature` knows the graph.

## Hot reload

### Why Emacs gets it for free

`(load-file)` re-evaluates. `defun` overwrites the symbol's function cell. `defvar` only sets if void, so global state survives. Callers look up by symbol at call time, so the next call sees the new definition. There's no "instance of the editor class" to invalidate — the editor *is* the global state.

### Why jemacs half-has it

`evaluator.loadPlugin` already cache-busts with `?t=` and re-runs `install(editor)`. `editor.command(name, fn)` already overwrites. So redefining a command works today. What breaks:

1. **Accumulation.** `addHook`, `addAdvice`, `editor.key` are additive. Reload a plugin → its hook runs twice.
2. **Closure state.** `killRingHistory` is a `let` in `commands.ts`. Reload → fresh empty array, kill ring lost. (Elisp avoids this by putting state in `defvar`s.)
3. **The Editor class.** Methods like `recenterTopBottom` live on the prototype of an instance that already exists. Re-importing `editor.ts` gives a new class; the running instance still points at the old prototype.

### Fixes

**1. `PluginContext` — disposable registration.**

```ts
export type PluginContext = {
  command(name: string, fn: CommandFn, doc?: string): void
  key(map: string, seq: string, cmd: string): void
  hook(name: string, fn: HookFn): void
  advice(cmd: string, where: AdviceWhere, fn: AdviceFn): void
  minorMode(spec: MinorModeSpec): void
  onDispose(fn: () => void): void          // fs.watch handles, timers
}
```

`loadPlugin(path)` keeps `Map<resolvedPath, PluginContext>`. Before re-install it calls `ctx.dispose()`, which walks the recorded registrations and undoes each (unbind key, remove hook, clear advice, drop command). Then `install(editor, ctx)` runs fresh. This is VSCode's `ExtensionContext.subscriptions` pattern; it's also what `unload-feature` does via `<feature>-unload-function` + the load-history.

`ctx.command` / `ctx.key` are thin wrappers over `editor.command` / `editor.defineKey` that also push an undo thunk.

**2. State in `defvar`, not closures.**

`defvar` already has set-if-unbound semantics (`custom.ts:21` early-returns the existing entry on redefinition). So:

```ts
// before — lost on reload
let killRing: string[] = []
// after — survives reload
const killRing = defvar("kill-ring", [] as string[]).value
```

A lint rule "no module-level `let` in `lisp/` or `plugins/`" enforces it.

Per-buffer state goes in `buffer.locals` (already a `Map<string, unknown>`). Per-editor state that isn't a defvar goes in a `WeakMap<Editor, T>` keyed on the editor instance — survives module reload because the key is the same object. Several plugins (`mark-ring`, `next-error`) already do this.

**3. Shrink Editor to a state holder.**

After the core/lisp split above, `Editor` is just data + `handleKey` + `run(command)`. Reloading "the editor" then means reloading `lisp/*` — which works via 1+2. The kernel itself (the actual `Editor` class, `BufferModel`, the keymap matcher) is restart-only, but it's small and stable so that's the right tradeoff — same as Emacs's C core.

For working on the kernel without restarts: a dev-only `editor.__replaceMethod(name, fn)` that does `Object.getPrototypeOf(editor)[name] = fn` lets you live-patch a single method from `eval-expression`. Useful, dirty, not for production code paths.

### The reload command

```ts
ctx.command("reload-plugin", async ({ editor, args }) => {
  const path = args[0] ?? editor.currentBuffer.path
  await evaluator.loadPlugin(path)   // dispose old ctx → import?t= → install(editor, newCtx)
})
ctx.key("C-c C-l", "reload-plugin")  // already bound; semantics upgrade
```

`C-c C-l` in a plugin buffer gives the Emacs `C-M-x`-on-a-file experience: edit, reload, the running editor picks it up, and the previous registration is cleanly torn down first.

## Sequencing

1. `PluginContext` + `loadPlugin` dispose tracking. Non-breaking: `install(editor)` still works; `install(editor, ctx)` is the new signature.
2. Sweep `plugins/*` to take `ctx` and route registrations through it.
3. Advice `:around`/`:override`; fire the standard hooks from kernel call sites.
4. Carve `lisp/` out of `editor.ts` + `core/commands.ts`, one file at a time, each as a `ctx`-taking install. `loadup.ts` lists them.
5. Move `config/user.ts` → `~/.jemacs/init.ts`; auto-load it.
6. `defgeneric`/`defmethod`; convert `Mode` behavior fields to methods.
