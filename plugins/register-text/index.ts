import type { Editor } from "../../src/kernel/editor"
import type { CommandContext } from "../../src/kernel/command"
import type { RegisterContents } from "../../src/kernel/register"
import { createPluginContext, type PluginContext } from "../../src/runtime/plugin-context"

function regionBounds(buffer: { mark: number | null; point: number }): [number, number] | null {
  if (buffer.mark == null) return null
  return [buffer.mark, buffer.point].sort((a, b) => a - b) as [number, number]
}

function numberAtPoint(buffer: { text: string; point: number }): { value: number; end: number } | null {
  const match = /^[+-]?\d+/.exec(buffer.text.slice(buffer.point))
  if (!match) return null
  return { value: Number(match[0]), end: buffer.point + match[0].length }
}

function registerDescription(editor: Editor, register: string, value: RegisterContents, verbose = false): string {
  const prefix = `Register ${register} contains `
  if (value.kind === "text") return `${prefix}${JSON.stringify(value.text)}`
  if (value.kind === "number") return `${prefix}${value.value}`
  if (value.kind === "rectangle") {
    if (verbose) return `${prefix}the rectangle:\n${value.lines.map(line => `    ${line}`).join("\n")}`
    return `${prefix}a rectangle starting with ${value.lines[0] ?? ""}`
  }
  if (value.kind === "point") {
    const buffer = value.bufferId ? editor.buffers.get(value.bufferId) : null
    const name = buffer?.name ?? "unknown buffer"
    return `${prefix}a buffer position:\n    buffer ${name}, position ${value.point}`
  }
  return `${prefix}a window configuration.`
}

export function install(editor: Editor, ctx: PluginContext = createPluginContext(editor)): void {
  editor.command("copy-to-register", async ({ buffer, editor, args, prefixArgument }) => {
    const register = args[0] ?? await editor.prompt("Copy to register: ", "", "register")
    if (!register) return
    const bounds = regionBounds(buffer)
    if (!bounds) { editor.message("No mark set in this buffer"); return }
    const [start, end] = bounds
    editor.registers.set(register, { kind: "text", text: buffer.text.slice(start, end) })
    if (prefixArgument != null) buffer.deleteRange(start, end)
    editor.message(`Copied region to register ${register}`)
  }, "Copy region into register; with prefix arg, delete the region after copying.")

  const appendPrepend = async (mode: "append" | "prepend", { buffer, editor, args, prefixArgument }: CommandContext) => {
    const register = args[0] ?? await editor.prompt(`${mode === "append" ? "Append" : "Prepend"} to register: `, "", "register")
    if (!register) return
    const bounds = regionBounds(buffer)
    if (!bounds) { editor.message("No mark set in this buffer"); return }
    const [start, end] = bounds
    const text = buffer.text.slice(start, end)
    const value = editor.registers.get(register)
    if (value && value.kind !== "text") {
      editor.message(`Register ${register} does not contain text`)
      return
    }
    const previous = value?.text ?? ""
    editor.registers.set(register, { kind: "text", text: mode === "append" ? previous + text : text + previous })
    if (prefixArgument != null) buffer.deleteRange(start, end)
    editor.message(`${mode === "append" ? "Appended" : "Prepended"} region to register ${register}`)
  }

  editor.command("append-to-register", async ctx => appendPrepend("append", ctx),
    "Append region of text to register; with prefix arg, delete the region after appending.")
  editor.command("prepend-to-register", async ctx => appendPrepend("prepend", ctx),
    "Prepend region of text to register; with prefix arg, delete the region after prepending.")

  editor.command("number-to-register", async ({ buffer, editor, args, prefixArgument }) => {
    const register = args[0] ?? await editor.prompt("Number to register: ", "", "register")
    if (!register) return
    let value: number
    if (args[1] != null) {
      value = Number(args[1])
      if (!Number.isFinite(value)) {
        editor.message(`Invalid number: ${args[1]}`)
        return
      }
    } else if (prefixArgument != null) {
      value = prefixArgument
    } else {
      const found = numberAtPoint(buffer)
      if (!found) {
        editor.message("No number at point")
        return
      }
      value = found.value
      buffer.point = found.end
    }
    editor.registers.set(register, { kind: "number", value })
    editor.message(`Stored ${value} in register ${register}`)
  }, "Store NUMBER in REGISTER.")

  editor.command("increment-register", async ctx => {
    const { editor, args, prefixArgument } = ctx
    const register = args[0] ?? await editor.prompt("Increment register: ", "", "register")
    if (!register) return
    const value = editor.registers.get(register)
    if (value?.kind === "number") {
      const amount = prefixArgument ?? 1
      value.value += amount
      editor.message(`Register ${register} now contains ${value.value}`)
      return
    }
    await appendPrepend("append", { ...ctx, args: [register], prefixArgument })
  }, "Augment contents of REGISTER using PREFIX.")

  editor.command("view-register", async ({ editor, args }) => {
    const register = args[0] ?? await editor.prompt("View register: ", "", "register")
    if (!register) return
    const value = editor.registers.get(register)
    if (!value) {
      editor.message(`Register ${register} is empty`)
      return
    }
    editor.scratch("*Output*", registerDescription(editor, register, value, true), "text")
  }, "Display the description of the contents of REGISTER.")

  editor.command("list-registers", ({ editor }) => {
    const lines = [...editor.registers.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([register, value]) => registerDescription(editor, register, value, false))
    editor.scratch("*Output*", lines.join("\n\n"), "text")
  }, "Display the list of nonempty registers with brief descriptions of contents.")

  editor.command("insert-register", async ({ buffer, editor, args, prefixArgument }) => {
    const register = args[0] ?? await editor.prompt("Insert register: ", "", "register")
    if (!register) return
    const value = editor.registers.get(register)
    if (!value) { editor.message(`Register ${register} is empty`); return }
    const text = value.kind === "text" ? value.text
      : value.kind === "number" ? String(value.value)
        : value.kind === "rectangle" ? value.lines.join("\n") : null
    if (text != null) {
      const start = buffer.point
      buffer.insert(text)
      const end = buffer.point
      if (prefixArgument != null) {
        buffer.mark = end
        buffer.point = start
      } else {
        buffer.mark = start
      }
      buffer.markActive = false
      return
    }
    editor.message(`Register ${register} does not contain text`)
  }, "Insert contents of register at point.")


  editor.key("C-x r s", "copy-to-register")
  editor.key("C-x r x", "copy-to-register")
  editor.key("C-x r i", "insert-register")
  editor.key("C-x r g", "insert-register")
  editor.key("C-x r n", "number-to-register")
  editor.key("C-x r +", "increment-register")
}
