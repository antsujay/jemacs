import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { install, sessions } from "../../plugins/term"
import type { Pty } from "../../plugins/term/pty"

function fakePty(): Pty & { sent: string } {
  let sent = ""
  return { pid: 0, get sent() { return sent }, write(d) { sent += d },
           resize() {}, onData() {}, onExit() {}, kill() {} }
}

test("term char-mode: editing keys (C-k) reach pty, not buffer", async () => {
  const editor = makeEditor()
  install(editor)
  const buf = editor.scratch("*term*", "$ hello\n")
  buf.mode = "term"
  const pty = fakePty()
  sessions.set(buf, { pty, lines: ["$ hello", ""], row: 1, col: 0 })

  await editor.run("term-char-mode")
  expect(buf.readOnly).toBe(true)
  expect(editor.overridingTerminalLocalMap).not.toBeNull()

  // C-k must dispatch term-send-raw and write 0x0b — not fall through to global kill-line.
  const r = await editor.handleKey({ name: "k", ctrl: true, sequence: "\x0b" })
  expect(r).toEqual({ status: "command", command: "term-send-raw" })
  expect(pty.sent).toBe("\x0b")
  expect(buf.text).toBe("$ hello\n")

  // C-c is the lone prefix escape; C-c C-j drops to line-mode.
  const p = await editor.handleKey({ name: "c", ctrl: true, sequence: "\x03" })
  expect(p.status).toBe("pending")
  await editor.handleKey({ name: "j", ctrl: true, sequence: "\n" })
  expect(buf.readOnly).toBe(false)
  expect(editor.overridingTerminalLocalMap).toBeNull()
})
