import type { Editor } from "../kernel/editor"
import { Evaluator } from "../runtime/evaluator"
import { inspectValue } from "../runtime/inspect"

export function installDefaultCommands(editor: Editor): Evaluator {
  const evaluator = new Evaluator(editor)

  editor.command("save-buffer", async ({ buffer, editor }) => {
    await buffer.save()
    editor.message(`Saved ${buffer.path}`)
  }, "Save the current buffer to disk.")

  editor.command("open-file", async ({ editor, args }) => {
    const path = args[0] ?? await editor.prompt("Find file: ")
    if (!path) return
    await editor.openFile(path)
    editor.message(`Opened ${path}`)
  }, "Open a file into a buffer.")

  editor.command("next-buffer", ({ editor }) => {
    const b = editor.nextBuffer()
    editor.message(`Switched to ${b.name}`)
  }, "Switch to the next buffer.")

  editor.command("set-mark", ({ buffer, editor }) => {
    buffer.setMark()
    editor.message(`Mark set at ${buffer.point}`)
  }, "Set mark at point.")

  editor.command("clear-mark", ({ buffer, editor }) => {
    buffer.clearMark()
    editor.message("Mark cleared")
  }, "Clear mark.")

  editor.command("undo", ({ buffer }) => buffer.undo(), "Undo the last text edit.")
  editor.command("redo", ({ buffer }) => buffer.redo(), "Redo the last undone text edit.")

  editor.command("eval-selection", async ({ buffer, editor }) => {
    const code = buffer.selectedOrAll()
    const result = await evaluator.eval(code, buffer.path ?? buffer.name)
    editor.message(`Eval => ${summarize(result)}`)
    return result
  }, "Evaluate the selection, or the whole buffer if no selection is active.")

  editor.command("eval-expression", async ({ editor, args }) => {
    const expression = args.join(" ") || await editor.prompt("Eval expression: ")
    if (!expression) return
    const result = await evaluator.evalExpression(expression)
    editor.scratch("*eval-result*", inspectValue(result), "text")
  }, "Evaluate a JavaScript expression and display its result.")

  editor.command("run-command", async ({ editor, args }) => {
    const name = args[0] ?? await editor.prompt("M-x ")
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

  editor.command("load-plugin", async ({ editor, args }) => {
    const path = args[0] ?? await editor.prompt("Load plugin: ", "plugins/demo-plugin.ts")
    if (!path) return
    await evaluator.loadPlugin(path)
    editor.message(`Loaded plugin ${path}`)
  }, "Load a plugin module exporting install(editor).")

  editor.command("show-messages", ({ editor }) => editor.switchToBuffer("*messages*"), "Switch to the messages buffer.")

  editor.command("quit", ({ editor }) => {
    editor.message("Quit requested")
    editor.quit()
  }, "Quit the editor.")

  editor.key("C-x C-s", "save-buffer")
  editor.key("C-x C-f", "open-file")
  editor.key("C-x C-b", "next-buffer")
  editor.key("C-x C-e", "eval-selection")
  editor.key("C-space", "set-mark")
  editor.key("C-_", "undo")
  editor.key("M-x", "run-command")
  editor.key("C-h e", "inspect-editor")
  editor.key("C-h c", "inspect-commands")
  editor.key("C-h k", "inspect-keymap")
  editor.key("C-c C-l", "load-plugin")
  editor.key("C-c C-q", "quit")

  return evaluator
}

function summarize(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value.slice(0, 80))
  if (typeof value === "undefined") return "undefined"
  if (value === null) return "null"
  if (typeof value === "object") return value.constructor?.name ?? "object"
  return String(value)
}
