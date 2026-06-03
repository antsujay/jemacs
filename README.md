# Jemacs OpenTUI

A small, self-editable Emacs-like editor prototype where JavaScript replaces Emacs Lisp and OpenTUI renders the terminal frontend.

This is intentionally a starter repo, not a mature editor. The kernel is written so that buffers, commands, keymaps, modes, and the evaluator are ordinary JavaScript/TypeScript objects that can be inspected and modified from inside the editor.

## Runtime and libraries checked

- `@opentui/core` is the only runtime dependency. OpenTUI's current docs describe it as a native Zig terminal UI core with TypeScript bindings and a component/renderable architecture.
- OpenTUI's getting-started docs currently say the TypeScript/JavaScript package is Bun-exclusive, with Node and Deno support in progress, so this repo is Bun-first.
- The OpenTUI docs show `createCliRenderer`, `Box`, `Text`, and `renderer.keyInput.on("keypress", ...)` as the core APIs used here.
- `@types/bun` is included only for TypeScript checking of Bun globals.
- `typescript` is included only for `bun x tsc --noEmit`.

## Install

```bash
bun install
```

If OpenTUI's native package build complains, install Zig. The upstream repo notes that Zig is required to build the packages when native code is involved.

## Run

```bash
bun run dev
# or open a file
bun run src/main.ts README.md
# or self-edit the editor
bun run dev:self
```

## Keybindings

| Key | Action |
| --- | --- |
| Type printable keys | Insert text |
| Return or Ctrl-J/Ctrl-M | Insert newline |
| Backspace | Delete backward |
| Left/Right or Ctrl-B/Ctrl-F | Move backward/forward one character |
| Up/Down or Ctrl-P/Ctrl-N | Move to previous/next line |
| Ctrl-A / Ctrl-E | Move to beginning/end of line |
| Meta-B / Meta-F | Move backward/forward one word |
| Ctrl-D | Delete forward |
| Ctrl-K / Ctrl-Y | Kill line / yank |
| Ctrl-W / Meta-W | Kill region / copy region |
| Ctrl-X Ctrl-S | Save current buffer |
| Ctrl-X Ctrl-E | Eval selection, or current buffer if no mark |
| Ctrl-X B | Switch to buffer |
| Ctrl-X Ctrl-B | List buffers |
| Ctrl-X Ctrl-F | Open file via minibuffer |
| Ctrl-Space | Set mark |
| Ctrl-G | Cancel minibuffer / clear key sequence |
| Meta-X / Alt-X / Esc X | Run command by name |
| Ctrl-H E | Inspect editor |
| Ctrl-H C | Inspect commands |
| Ctrl-H K | Inspect keymap |
| Ctrl-C Ctrl-L | Load plugin file via minibuffer |
| Ctrl-C Ctrl-R | Save and reload current file |
| Ctrl-X Ctrl-C or Ctrl-C Ctrl-Q | Quit |

## Self-editing demo

1. Start against the editor source:

   ```bash
   bun run src/main.ts src/init/default-commands.ts
   ```

2. Edit a command or add a new one.
3. Mark the relevant JavaScript/TypeScript expression or whole buffer.
4. Press `Ctrl-X Ctrl-E`.
5. Open `*messages*` or inspect the editor with `Ctrl-H E`.

For module-style plugin reloads, use `Ctrl-C Ctrl-L` and enter a plugin path, e.g.:

```text
plugins/demo-plugin.ts
```

The plugin's `install(editor)` function runs against the live editor object.

When visiting a TypeScript or JavaScript file, `Ctrl-C Ctrl-R` saves and cache-bust imports the current file. If the module exports `install(editor)` it is run as a plugin; if it exports `installDefaultCommands(editor)` those commands and keybindings are reinstalled in the running editor.

On macOS, some terminals send Option-key characters instead of Meta events, for example Option-X as `≈`. Jemacs maps the common Option encodings for `M-x`, `M-f`, and `M-b`, and `Esc x` works as the terminal-portable Meta-X fallback.

## Design notes

The editor kernel deliberately avoids OpenTUI imports. That keeps it testable and makes the frontend replaceable. The only OpenTUI-specific file is `src/ui/opentui.ts`.

The evaluator uses Bun's dynamic `Function` constructor rather than a hard security sandbox. Treat evaluated code and plugins as trusted user config, like Emacs Lisp. Do not run hostile plugins.
