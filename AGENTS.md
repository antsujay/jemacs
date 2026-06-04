# AGENTS.md

## Workflow

- Prefer small, focused changes that match the existing TypeScript style.
- Run `bun run check` and `bun test` after code changes when possible.
- If `bun` is not on `PATH`, run those commands through `npx bun`, e.g. `npx bun run check` and `npx bun test`.
- After implementing a feature, fix, or Emacs port, commit the change before handing work back to the user (unless they asked you not to commit).

## Emacs fidelity

When porting or replicating a GNU Emacs interactive function:

- **Name:** Register the command under the same GNU name (kebab-case, e.g. `beginning-of-buffer`). Do not invent Jemacs-specific command names unless Emacs has no equivalent.
- **Behavior:** Match Emacs semantics for that command; check `lisp/` or the manual when unsure.
- **Key:** Wire the default Emacs keybinding when one exists (`editor.key` / `defineKey` in `src/init/` or the relevant mode). See `DEFAULT_KEYBINDINGS.md` for what is already bound.
- **TypeScript identifiers:** Hyphenated Emacs names map to camelCase in code (`beginning-of-buffer` → helpers like `beginningOfBuffer`); the public command string stays kebab-case.
