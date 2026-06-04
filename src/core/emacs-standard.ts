import type { Editor } from "../kernel/editor"
import { BufferModel } from "../kernel/buffer"
import { readFileText } from "../platform/runtime"
export type KillRingApi = {
  pushKill: (text: string) => void
  getKill: () => string
  recordYank: (buffer: BufferModel, text: string) => void
  yankPop: (buffer: BufferModel) => void
}

export function installEmacsStandardCommands(editor: Editor, kill: KillRingApi): void {
  editor.command("beginning-of-buffer", ({ buffer }) => buffer.moveToBufferStart(), "Move point to the beginning of the buffer.")
  editor.command("end-of-buffer", ({ buffer }) => buffer.moveToBufferEnd(), "Move point to the end of the buffer.")
  editor.command("open-line", ({ buffer }) => {
    buffer.insert("\n")
    buffer.move(-1)
  }, "Insert a newline after point without moving point.")
  editor.command("transpose-chars", ({ buffer }) => {
    if (buffer.point < 1) return
    const i = buffer.point
    const text = buffer.text
    buffer.replaceRange(i - 1, i + 1, text[i]! + text[i - 1]!)
  }, "Transpose the character before point with the character at point.")
  editor.command("mark-whole-buffer", ({ buffer }) => {
    buffer.point = buffer.text.length
    buffer.setMark()
    buffer.point = 0
    buffer.markActive = true
  }, "Set mark at end and point at beginning of buffer.")
  editor.command("yank-pop", ({ buffer, editor }) => {
    kill.yankPop(buffer)
    editor.message("Yank pop")
  }, "Replace the last yank with the next item on the kill ring.")
  editor.command("quoted-insert", ({ editor }) => {
    editor.quotedInsertNext = true
    editor.message("Quoted insert — type a character")
  }, "Read the next input event and insert it literally.")
  editor.command("write-file", async ({ buffer, editor, args }) => {
    const path = args[0] ?? await editor.prompt("Write file: ", buffer.path ?? "", "write-file")
    if (!path) return
    buffer.path = path
    await buffer.save()
    editor.message(`Wrote ${path}`)
  }, "Write the current buffer to a specified file.")
  editor.command("find-alternate-file", async ({ buffer, editor, args }) => {
    const path = args[0] ?? await editor.completingRead("Find alternate file: ", {
      completion: "file",
      history: "file",
      initialValue: buffer.directory() ?? process.cwd(),
    })
    if (!path) return
    const text = await readFileText(path)
    buffer.path = path
    buffer.name = path.split("/").pop() ?? path
    buffer.setText(text, false)
    buffer.dirty = false
    buffer.point = Math.min(buffer.point, buffer.text.length)
    editor.enterMode(buffer, buffer.mode)
    editor.message(`Now visiting ${path}`)
  }, "Replace this buffer with the contents of another file.")
  editor.command("kill-buffer", async ({ editor, args }) => {
    const name = args[0] ?? await editor.completingRead("Kill buffer: ", {
      collection: [...editor.buffers.values()].filter(b => b.kind !== "minibuffer").map(b => b.name),
      history: "buffer",
      initialValue: editor.currentBuffer.name,
    })
    if (!name) return
    const killed = editor.killBuffer(name)
    if (killed) editor.message(`Killed buffer ${killed.name}`)
  }, "Kill the current buffer or a specified buffer.")
  editor.command("delete-other-windows", ({ editor }) => {
    editor.deleteOtherWindows()
    editor.message("Deleted other windows")
  }, "Keep the selected window and delete all others.")
  editor.command("split-window-below", ({ editor }) => editor.splitWindowBelow(), "Split the selected window below.")
  editor.command("split-window-right", ({ editor }) => editor.splitWindowRight(), "Split the selected window to the right.")
  editor.command("recenter-top-bottom", ({ editor }) => {
    editor.recenterTopBottom()
    editor.message("Recenter")
  }, "Center point vertically in the window.")
  editor.command("query-replace", async ({ buffer, editor, args }) => {
    const from = args[0] ?? await editor.prompt("Query replace: ", "", "query-replace")
    if (!from) return
    const to = args[1] ?? await editor.prompt(`Replace ${from} with: `, "", "query-replace")
    if (to == null) return
    let index = 0
    while (index <= buffer.text.length) {
      const at = buffer.text.indexOf(from, index)
      if (at === -1) break
      buffer.point = at
      const choice = await editor.prompt(`Replace \"${from}\"? (y/n/q) `, "y", "query-replace")
      if (choice === "q" || choice === null) break
      if (choice === "y" || choice === "Y") {
        buffer.replaceRange(at, at + from.length, to)
        index = at + to.length
      } else {
        index = at + from.length
      }
    }
    editor.message("Query replace finished")
  }, "Replace occurrences with confirmation.")
  editor.command("apropos-command", async ({ editor, args }) => {
    const pattern = args[0] ?? await editor.prompt("Apropos: ", "", "apropos")
    if (!pattern) return
    const re = new RegExp(pattern, "i")
    const lines = editor.commands.entries()
      .filter(c => re.test(c.name) || re.test(c.description ?? ""))
      .map(c => `${c.name.padEnd(24)} ${c.description ?? ""}`)
    editor.scratch("*Help*", lines.join("\n") || "No matches", "text")
  }, "Show commands matching a pattern.")
  editor.command("help-command", ({ editor }) => {
    editor.message("Help (C-h …): b bindings, c mode, k key, f function, v variable, a apropos, e messages, i info")
  }, "Display help key prefix summary.")
  editor.command("help-for-help", ({ editor }) => {
    const lines = [
      "C-h b    describe-bindings",
      "C-h c    describe-mode",
      "C-h k    describe-key",
      "C-h f    describe-function (RET follows source)",
      "C-h v    describe-variable (custom; RET → source)",
      "C-h a    apropos-command",
      "C-h e    view-echo-area-messages",
      "C-h i    info",
      "C-h C-h  help-for-help",
    ]
    editor.scratch("*Help*", lines.join("\n"), "text")
  }, "Describe help commands.")
  editor.command("info", ({ editor }) => {
    editor.message("Info manual reader is not bundled in Jemacs yet.")
  }, "Read Info documentation (placeholder).")
  editor.command("count-lines-page", ({ buffer, editor }) => {
    const lines = buffer.text.split("\n").length
    editor.message(`${lines} lines in buffer`)
  }, "Count lines in the current page.")
  editor.command("start-kbd-macro", ({ editor }) => {
    editor.macroRecording = []
    editor.message("Starting keyboard macro")
  }, "Start recording a keyboard macro.")
  editor.command("end-kbd-macro", ({ editor }) => {
    if (!editor.macroRecording) {
      editor.message("No macro definition in progress")
      return
    }
    editor.lastKbdMacro = editor.macroRecording
    editor.macroRecording = null
    editor.message(`Keyboard macro defined (${editor.lastKbdMacro.length} events)`)
  }, "Finish defining a keyboard macro.")
  editor.command("call-last-kbd-macro", async ({ editor }) => {
    if (!editor.lastKbdMacro.length) {
      editor.message("No keyboard macro defined")
      return
    }
    for (const command of editor.lastKbdMacro) await editor.run(command)
    editor.message("Executed keyboard macro")
  }, "Call the last keyboard macro.")
  editor.command("kill-rectangle", ({ buffer, editor }) => {
    if (buffer.mark == null) {
      editor.message("Mark must be set for rectangle command")
      return
    }
    const killed = killRectangle(buffer)
    kill.pushKill(killed)
    editor.message("Killed rectangle")
  }, "Kill the text in the rectangle defined by point and mark.")
  editor.command("yank-rectangle", ({ buffer, editor }) => {
    const text = kill.getKill()
    if (!text) return
    yankRectangle(buffer, text)
    editor.message("Yanked rectangle")
  }, "Insert the last killed rectangle.")
}

function killRectangle(buffer: BufferModel): string {
  const start = Math.min(buffer.mark ?? buffer.point, buffer.point)
  const end = Math.max(buffer.mark ?? buffer.point, buffer.point)
  const startLine = buffer.text.slice(0, start).split("\n").length - 1
  const endLine = buffer.text.slice(0, end).split("\n").length - 1
  const startCol = start - (buffer.text.lastIndexOf("\n", start - 1) + 1)
  const endCol = end - (buffer.text.lastIndexOf("\n", end - 1) + 1)
  const colA = Math.min(startCol, endCol)
  const colB = Math.max(startCol, endCol)
  const lines = buffer.text.split("\n")
  const chunks: string[] = []
  for (let line = startLine; line <= endLine; line++) {
    const text = lines[line] ?? ""
    chunks.push(text.slice(colA, colB))
  }
  const killed = chunks.join("\n")
  const rebuilt = lines.map((text, line) => {
    if (line < startLine || line > endLine) return text
    return text.slice(0, colA) + text.slice(colB)
  }).join("\n")
  buffer.setText(rebuilt, true)
  buffer.point = start
  buffer.clearMark()
  return killed
}

function yankRectangle(buffer: BufferModel, rectangle: string): void {
  const lines = rectangle.split("\n")
  const { line, col } = buffer.lineCol()
  const parts = buffer.text.split("\n")
  for (let i = 0; i < lines.length; i++) {
    const idx = line - 1 + i
    if (idx < 0 || idx >= parts.length) break
    const row = parts[idx]!
    const at = Math.min(col - 1, row.length)
    parts[idx] = row.slice(0, at) + lines[i]! + row.slice(at)
  }
  buffer.setText(parts.join("\n"), true)
}
