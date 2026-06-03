import { dirname } from "node:path"
import type { Editor } from "../kernel/editor"
import { diredEntryAtPoint, refreshDiredBuffer } from "../modes/dired"
import { pythonBeginningOfDefun, pythonEndOfDefun } from "../modes/python"
import { Evaluator } from "../runtime/evaluator"
import { inspectValue } from "../runtime/inspect"

export function installDefaultCommands(editor: Editor): Evaluator {
  const evaluator = new Evaluator(editor)
  let killRing = ""

  editor.command("save-buffer", async ({ buffer, editor }) => {
    await buffer.save()
    editor.message(`Saved ${buffer.path}`)
  }, "Save the current buffer to disk.")

  editor.command("open-file", async ({ editor, args }) => {
    const path = args[0] ?? await editor.completingRead("Find file: ", { collection: [], history: "file" })
    if (!path) return
    await editor.openFile(path)
    editor.message(`Opened ${path}`)
  }, "Open a file into a buffer.")

  editor.command("next-buffer", ({ editor }) => {
    const b = editor.nextBuffer()
    editor.message(`Switched to ${b.name}`)
  }, "Switch to the next buffer.")

  editor.command("switch-to-buffer", async ({ editor, args }) => {
    const current = editor.currentBuffer.name
    const name = args[0] ?? await editor.completingRead("Switch to buffer: ", { collection: [...editor.buffers.values()].map(b => b.name), history: "buffer", initialValue: current })
    if (!name) return
    const buffer = editor.switchToBuffer(name)
    editor.message(`Switched to ${buffer.name}`)
  }, "Prompt for a buffer name and switch to it.")

  editor.command("list-buffers", ({ editor }) => {
    const lines = [...editor.buffers.values()].map(buffer => {
      const current = buffer.id === editor.currentBufferId ? "." : " "
      const dirty = buffer.dirty ? "*" : " "
      const path = buffer.path ? `  ${buffer.path}` : ""
      return `${current}${dirty}  ${buffer.name.padEnd(24)} ${buffer.mode}${path}`
    })
    editor.scratch("*Buffer List*", lines.join("\n"), "text")
  }, "Display the buffer list.")

  editor.command("set-mark", ({ buffer, editor }) => {
    buffer.setMark()
    editor.message(`Mark set at ${buffer.point}`)
  }, "Set mark at point.")

  editor.command("clear-mark", ({ buffer, editor }) => {
    buffer.clearMark()
    editor.message("Mark cleared")
  }, "Clear mark.")

  editor.command("keyboard-quit", ({ buffer, editor }) => {
    editor.keymap.clearPending()
    editor.keymaps.clearPending()
    if (editor.minibuffer) editor.minibufferCancel()
    buffer.clearMark()
    editor.message("Quit")
  }, "Cancel the active key sequence, minibuffer, or mark.")

  editor.command("forward-char", ({ buffer }) => buffer.move(1), "Move point forward one character.")
  editor.command("backward-char", ({ buffer }) => buffer.move(-1), "Move point backward one character.")
  editor.command("next-line", ({ buffer }) => buffer.moveLine(1), "Move point down one line.")
  editor.command("previous-line", ({ buffer }) => buffer.moveLine(-1), "Move point up one line.")
  editor.command("beginning-of-line", ({ buffer }) => buffer.moveToLineStart(), "Move point to the beginning of the line.")
  editor.command("end-of-line", ({ buffer }) => buffer.moveToLineEnd(), "Move point to the end of the line.")
  editor.command("forward-word", ({ buffer }) => buffer.moveWord(1), "Move point forward one word.")
  editor.command("backward-word", ({ buffer }) => buffer.moveWord(-1), "Move point backward one word.")
  editor.command("newline", ({ buffer }) => buffer.insert("\n"), "Insert a newline at point.")
  editor.command("delete-char", ({ buffer }) => buffer.deleteForward(), "Delete the character after point.")
  editor.command("delete-backward-char", ({ buffer }) => buffer.deleteBackward(), "Delete the character before point.")
  editor.command("kill-line", ({ buffer }) => {
    const lineEnd = buffer.text.indexOf("\n", buffer.point)
    const end = lineEnd === -1 ? buffer.text.length : lineEnd + (lineEnd === buffer.point ? 1 : 0)
    killRing = buffer.deleteRange(buffer.point, end)
  }, "Kill text from point to end of line.")
  editor.command("kill-region", ({ buffer, editor }) => {
    if (buffer.mark == null || buffer.mark === buffer.point) {
      editor.message("No region active")
      return
    }
    killRing = buffer.deleteRange(buffer.mark, buffer.point)
    buffer.clearMark()
  }, "Kill the active region.")
  editor.command("copy-region", ({ buffer, editor }) => {
    const selected = buffer.selectedText()
    if (!selected) {
      editor.message("No region active")
      return
    }
    killRing = selected
    editor.message("Copied region")
  }, "Copy the active region to the kill ring.")
  editor.command("yank", ({ buffer }) => buffer.insert(killRing), "Insert the last killed text at point.")

  editor.command("undo", ({ buffer }) => buffer.undo(), "Undo the last text edit.")
  editor.command("redo", ({ buffer }) => buffer.redo(), "Redo the last undone text edit.")

  editor.command("eval-selection", async ({ buffer, editor }) => {
    const code = buffer.selectedOrAll()
    const result = await evaluator.eval(code, buffer.path ?? buffer.name)
    editor.message(`Eval => ${summarize(result)}`)
    return result
  }, "Evaluate the selection, or the whole buffer if no selection is active.")

  editor.command("eval-expression", async ({ editor, args }) => {
    const expression = args.join(" ") || await editor.prompt("Eval expression: ", "", "eval-expression")
    if (!expression) return
    const result = await evaluator.evalExpression(expression)
    editor.scratch("*eval-result*", inspectValue(result), "text")
  }, "Evaluate a JavaScript expression and display its result.")

  editor.command("run-command", async ({ editor, args }) => {
    const name = args[0] ?? await editor.completingRead("M-x ", { collection: editor.commands.names(), history: "command" })
    if (!name) return
    const rest = args.length > 1 ? args.slice(1) : []
    await editor.run(name, rest)
  }, "Prompt for and run a command.")

  editor.command("inspect-editor", ({ editor }) => {
    editor.scratch("*editor-inspector*", inspectValue(editor, 4), "text")
  }, "Inspect the live editor object.")

  editor.command("inspect-commands", ({ editor }) => {
    const lines = editor.commands.entries().map(c => `${c.name.padEnd(24)} ${c.description ?? ""}`)
    editor.scratch("*commands*", lines.join("\n"), "text")
  }, "List registered commands.")

  editor.command("inspect-keymap", ({ editor }) => {
    const lines = editor.keymap.all().map(([k, v]) => `${k.padEnd(16)} ${v}`)
    editor.scratch("*keymap*", lines.join("\n"), "text")
  }, "List keybindings.")

  editor.command("describe-key", async ({ editor, args }) => {
    const sequence = args.join(" ") || await editor.prompt("Describe key: ", "", "describe-key")
    if (!sequence) return
    editor.scratch("*Help*", editor.describeKey(sequence), "text")
  }, "Describe the command bound to a key sequence.")

  editor.command("minibuffer-complete", ({ editor }) => editor.minibufferComplete(), "Complete the current minibuffer input.")
  editor.command("minibuffer-submit", ({ editor }) => editor.minibufferSubmit(), "Submit the minibuffer.")
  editor.command("minibuffer-cancel", ({ editor }) => editor.minibufferCancel(), "Cancel the minibuffer.")
  editor.command("minibuffer-backspace", ({ editor }) => editor.minibufferBackspace(), "Delete one character in the minibuffer.")

  editor.command("indent-for-tab-command", ({ editor, buffer }) => {
    if (!editor.completeAtPoint(buffer)) editor.indentLine(buffer)
  }, "Complete the symbol at point, or indent the current line.")

  editor.command("python-beginning-of-defun", ({ buffer }) => pythonBeginningOfDefun(buffer), "Move to the beginning of the current Python def or class.")
  editor.command("python-end-of-defun", ({ buffer }) => pythonEndOfDefun(buffer), "Move to the end of the current Python def or class.")
  editor.command("python-shell-switch-to-shell", ({ editor }) => {
    editor.scratch("*Python*", "Python shell integration is not implemented yet.\n", "text")
  }, "Switch to the Python shell buffer placeholder.")

  editor.command("dired", async ({ editor, args }) => {
    const path = args[0] ?? await editor.completingRead("Dired: ", { collection: [], history: "file", initialValue: editor.currentBuffer.directory() ?? process.cwd() })
    if (!path) return
    await editor.openDirectory(path)
  }, "Open a directory in Dired.")
  editor.command("dired-revert", async ({ buffer, editor }) => {
    await refreshDiredBuffer(buffer)
    editor.message(`Reverted ${buffer.path}`)
  }, "Refresh the current Dired buffer.")
  editor.command("dired-find-file", async ({ buffer, editor }) => {
    const entry = diredEntryAtPoint(buffer)
    if (!entry) return
    await editor.openFile(entry.path)
  }, "Visit the file or directory on the current Dired line.")
  editor.command("dired-up-directory", async ({ buffer, editor }) => {
    if (!buffer.path) return
    await editor.openDirectory(dirname(buffer.path))
  }, "Open the parent directory in Dired.")
  editor.command("quit-window", ({ editor }) => {
    editor.nextBuffer()
  }, "Bury the current special buffer and select another buffer.")

  editor.command("load-theme", ({ editor }) => {
    editor.setTheme(editor.theme)
    editor.message(`Loaded theme ${editor.theme.name}`)
  }, "Reload the active theme.")

  editor.command("load-plugin", async ({ editor, args }) => {
    const path = args[0] ?? await editor.prompt("Load plugin: ", "plugins/demo-plugin.ts", "file")
    if (!path) return
    await evaluator.loadPlugin(path)
    editor.message(`Loaded plugin ${path}`)
  }, "Load a plugin module exporting install(editor).")

  editor.command("reload-current-file", async ({ buffer, editor }) => {
    if (!buffer.path) {
      editor.message("Current buffer is not visiting a file")
      return
    }
    if (buffer.dirty) await buffer.save()
    const mod = await evaluator.loadModule(buffer.path)
    if (typeof mod.install === "function") {
      await mod.install(editor)
      editor.message(`Reloaded ${buffer.name} via install(editor)`)
      return
    }
    if (typeof mod.installDefaultCommands === "function") {
      mod.installDefaultCommands(editor)
      editor.message(`Reloaded ${buffer.name} via installDefaultCommands(editor)`)
      return
    }
    editor.message(`Reloaded ${buffer.name}; no installer export found`)
  }, "Save and reload the current TypeScript/JavaScript file into the live editor.")

  editor.command("show-messages", ({ editor }) => editor.switchToBuffer("*messages*"), "Switch to the messages buffer.")

  editor.command("quit", ({ editor }) => {
    editor.message("Quit requested")
    editor.quit()
  }, "Quit the editor.")

  editor.key("C-x C-s", "save-buffer")
  editor.key("C-x C-f", "open-file")
  editor.key("C-x b", "switch-to-buffer")
  editor.key("C-x C-b", "list-buffers")
  editor.key("C-x C-e", "eval-selection")
  editor.key("C-x C-c", "quit")
  editor.key("C-space", "set-mark")
  editor.key("C-g", "keyboard-quit")
  editor.key("C-f", "forward-char")
  editor.key("C-b", "backward-char")
  editor.key("C-n", "next-line")
  editor.key("C-p", "previous-line")
  editor.key("C-a", "beginning-of-line")
  editor.key("C-e", "end-of-line")
  editor.key("M-f", "forward-word")
  editor.key("M-b", "backward-word")
  editor.key("esc f", "forward-word")
  editor.key("esc b", "backward-word")
  editor.key("C-m", "newline")
  editor.key("C-j", "newline")
  editor.key("tab", "indent-for-tab-command")
  editor.key("C-i", "indent-for-tab-command")
  editor.key("C-d", "delete-char")
  editor.key("C-k", "kill-line")
  editor.key("C-w", "kill-region")
  editor.key("M-w", "copy-region")
  editor.key("C-y", "yank")
  editor.key("C-_", "undo")
  editor.key("M-x", "run-command")
  editor.key("esc x", "run-command")
  editor.key("C-h e", "inspect-editor")
  editor.key("C-h c", "inspect-commands")
  editor.key("C-h k", "describe-key")
  editor.key("C-x d", "dired")
  editor.key("C-c C-l", "load-plugin")
  editor.key("C-c C-r", "reload-current-file")
  editor.key("C-c C-q", "quit")
  editor.defineKey("minibuffer", "tab", "minibuffer-complete")
  editor.defineKey("minibuffer", "C-i", "minibuffer-complete")
  editor.defineKey("minibuffer", "enter", "minibuffer-submit")
  editor.defineKey("minibuffer", "C-m", "minibuffer-submit")
  editor.defineKey("minibuffer", "esc", "minibuffer-cancel")
  editor.defineKey("minibuffer", "backspace", "minibuffer-backspace")

  return evaluator
}

function summarize(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.slice(0, 80))
  if (typeof value === "undefined") return "undefined"
  if (value === null) return "null"
  if (typeof value === "object") return value.constructor?.name ?? "object"
  return String(value)
}
