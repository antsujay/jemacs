import type { Editor } from "../kernel/editor"
import { BufferModel } from "../kernel/buffer"
import type { TextSpan } from "../modes/mode"
import { readFileText } from "../platform/runtime"
import { keyToken } from "../kernel/keymap"
import { getCustom } from "../runtime/custom"

/** Read one keystroke as an Emacs key token (e.g. "y", "C-g", "RET") without
 *  opening a minibuffer. Resolves to `null` on C-g. The next handleKey call is
 *  consumed entirely — it never reaches the keymap stack or self-insert. */
export function readKey(editor: Editor, prompt: string): Promise<string | null> {
  editor.message(prompt)
  return new Promise(resolve => {
    const original = editor.handleKey
    editor.handleKey = async key => {
      editor.handleKey = original
      const token = keyToken(key)
      resolve(token === "C-g" ? null : token)
      return { status: "command", command: "read-key" }
    }
  })
}

export type KillRingApi = {
  pushKill: (text: string) => void
  getKill: () => string
  recordYank: (buffer: BufferModel, text: string) => void
  yankPop: (buffer: BufferModel) => void
}

export function installEmacsStandardCommands(editor: Editor, kill: KillRingApi): void {
  editor.command("beginning-of-buffer", ({ buffer }) => {
    if (buffer.point !== 0) { buffer.mark = buffer.point; buffer.markActive = false }
    buffer.moveToBufferStart()
  }, "Set mark (without activating) and move point to the beginning of the buffer.")
  editor.command("end-of-buffer", ({ buffer }) => {
    if (buffer.point !== buffer.text.length) { buffer.mark = buffer.point; buffer.markActive = false }
    buffer.moveToBufferEnd()
  }, "Set mark (without activating) and move point to the end of the buffer.")
  editor.command("open-line", ({ buffer }) => {
    buffer.insert("\n")
    buffer.move(-1)
  }, "Insert a newline after point without moving point.")
  editor.command("transpose-chars", ({ buffer }) => {
    if (buffer.point >= buffer.text.length) buffer.move(-1)
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
    try {
      await buffer.save({
        confirm: async p => (await readKey(editor, `${p} (y or n) `)) === "y",
        runHook: (h, b) => editor.runHook(h, b),
        makeBackupFiles: getCustom("make-backup-files"),
      })
      editor.message(`Wrote ${path}`)
    } catch (err) {
      editor.message((err as Error).message)
    }
  }, "Write the current buffer to a specified file.")
  editor.command("find-alternate-file", async ({ buffer, editor, args }) => {
    const path = args[0] ?? await editor.completingRead("Find alternate file: ", {
      completion: "file",
      history: "file",
      initialValue: buffer.directory() ?? process.cwd(),
    })
    if (!path) return
    if (buffer.dirty && buffer.path) {
      const ans = await readKey(editor, `Buffer ${editor.bufferDisplayName(buffer)} modified; kill anyway? (y or n) `)
      if (ans !== "y") { editor.message("Cancelled"); return }
    }
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
      collection: [...editor.buffers.values()].filter(b => b.kind !== "minibuffer").map(b => editor.bufferDisplayName(b)),
      history: "buffer",
      initialValue: editor.bufferDisplayName(editor.currentBuffer),
    })
    if (!name) return
    const target = editor.buffers.get(name)
      ?? [...editor.buffers.values()].find(b => b.name === name || editor.bufferDisplayName(b) === name)
    const display = target ? editor.bufferDisplayName(target) : name
    if (target?.dirty && target.path) {
      const ans = await readKey(editor, `Buffer ${display} modified; kill anyway? (y, n, s) `)
      if (ans === "s") {
        try {
          await target.save({
            confirm: async p => (await readKey(editor, `${p} (y or n) `)) === "y",
            makeBackupFiles: getCustom("make-backup-files"),
          })
        } catch (err) { editor.message((err as Error).message); return }
      } else if (ans !== "y") { editor.message("Cancelled"); return }
    }
    const killed = editor.killBuffer(name)
    if (killed) editor.message(`Killed buffer ${display}`)
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
  let qrBuffer: BufferModel | null = null
  let qrCurrent: TextSpan[] = []
  editor.addOverlaySource(b => (b === qrBuffer ? qrCurrent : []))
  editor.command("query-replace", async ({ buffer, editor, args }) => {
    const from = args[0] ?? await editor.prompt("Query replace: ", "", "query-replace")
    if (!from) return
    const to = args[1] ?? await editor.prompt(`Replace ${from} with: `, "", "query-replace")
    if (to == null) return
    let index = buffer.point
    let count = 0
    let all = false
    qrBuffer = buffer
    const trail: Array<{ at: number; replaced: boolean }> = []
    try {
    while (index <= buffer.text.length) {
      const at = buffer.text.indexOf(from, index)
      if (at === -1) break
      buffer.point = at
      qrCurrent = [{ start: at, end: at + from.length, face: "isearch" }]
      const key = all ? "y" : await readKey(editor, `Query replacing ${from} with ${to}: (y n q ! . ^) `)
      if (key === null || key === "q" || key === "enter" || key === "esc") break
      if (key === "y" || key === "space" || key === "!" || key === ".") {
        buffer.replaceRange(at, at + from.length, to)
        trail.push({ at, replaced: true })
        index = at + to.length
        count++
        if (key === "!") all = true
        if (key === ".") break
      } else if (key === "n" || key === "backspace") {
        trail.push({ at, replaced: false })
        index = at + from.length
      } else if (key === "^") {
        const prev = trail.pop()
        if (!prev) { editor.message("No previous match"); continue }
        if (prev.replaced) { buffer.replaceRange(prev.at, prev.at + to.length, from); count-- }
        index = prev.at
      }
      // any other key: re-prompt at the same match
    }
    } finally {
      qrCurrent = []
      qrBuffer = null
    }
    editor.message(`Replaced ${count} occurrence${count === 1 ? "" : "s"}`)
  }, "Replace occurrences with confirmation.")
  editor.command("revert-buffer", async ({ buffer, editor, args }) => {
    if (!buffer.path) {
      editor.message("Current buffer is not visiting a file")
      return
    }
    // Emacs gates on confirmation when modified (files.el:7102); auto-revert passes noconfirm to bypass.
    if (buffer.dirty && !args[0]) {
      const ans = await readKey(editor, `Discard edits and reread from ${buffer.path}? (y or n) `)
      if (ans !== "y") { editor.message("Revert cancelled"); return }
    }
    await buffer.revert()
    buffer.point = Math.min(buffer.point, buffer.text.length)
    editor.message(`Reverted ${editor.bufferDisplayName(buffer)}`)
  }, "Reload the current file from disk, confirming first if the buffer is modified.")
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
      "C-h m    describe-mode",
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
