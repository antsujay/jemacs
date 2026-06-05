import type { Editor } from "../kernel/editor"

export type InteractiveArgCode = "s" | "b" | "B"

export type ParsedInteractiveForm = {
  codes: InteractiveArgCode[]
  prompt: string
}

/** Parse a minimal Emacs `interactive` form, e.g. `(s)File: "` or `(b)Buffer: "`. */
export function parseInteractiveForm(form: string): ParsedInteractiveForm {
  const match = form.match(/^\(([^)]*)\)\s*(.*)$/s)
  if (!match) throw new Error(`Invalid interactive form: ${form}`)
  const codes = [...match[1]!].filter((c): c is InteractiveArgCode => c === "s" || c === "b" || c === "B")
  if (!codes.length) throw new Error(`No supported interactive codes in: ${form}`)
  return { codes, prompt: match[2] ?? "" }
}

export async function readInteractiveArgs(editor: Editor, form: string): Promise<string[]> {
  const { codes, prompt } = parseInteractiveForm(form)
  const args: string[] = []
  for (const code of codes) {
    if (code === "s") {
      const value = await editor.prompt(prompt)
      if (value == null) throw new Error("Quit")
      args.push(value)
      continue
    }
    if (code === "b" || code === "B") {
      const names = [...editor.buffers.values()].map(b => editor.bufferDisplayName(b)).sort()
      const value = await editor.completingRead(prompt, { collection: names })
      if (value == null) throw new Error("Quit")
      args.push(value)
    }
  }
  return args
}
