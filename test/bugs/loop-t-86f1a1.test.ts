import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { install, sessions, termRawMap } from "../../plugins/term"
import type { Pty } from "../../plugins/term/pty"

function fakePty(): Pty & { sent: string } {
  let sent = ""
  return { pid: 0, get sent() { return sent }, write(d) { sent += d },
           resize() {}, onData() {}, onExit() {}, kill() {} }
}

// t-86f1a1: char-mode C-c <printable> (e.g. C-c x) — TermRawMap.get() returned
// undefined for any multi-token seq, term-map/global-map have C-c as a prefix
// but no "C-c x" binding, so keymaps.feed → unmatched and dispatchKey fell into
// the isPrintable self-insert branch with the trailing key. char-mode sets
// buffer.readOnly=true, so self-insert threw and the echo area dumped a stack
// trace. Emacs term-raw-escape-map binds [t] → term-send-raw: the trailing key
// goes to the pty.
test("term char-mode: C-c <unbound printable> reaches pty, not self-insert", async () => {
  const editor = makeEditor()
  install(editor)
  const buf = editor.scratch("*term*", "")
  buf.mode = "term"
  const pty = fakePty()
  sessions.set(buf, { pty, lines: [""], row: 0, col: 0 })

  await editor.run("term-char-mode")
  expect(buf.readOnly).toBe(true)

  await editor.handleKey({ name: "c", ctrl: true, sequence: "\x03" })
  const r = await editor.handleKey({ name: "x", sequence: "x" })
  expect(r).toEqual({ status: "command", command: "term-send-raw" })
  expect(pty.sent).toBe("x")
  expect(buf.text).toBe("")

  // The raw-map fallback resolves the two-token sequence directly...
  expect(termRawMap.get("C-c x")).toBe("term-send-raw")
  expect(termRawMap.get("C-c o")).toBe("term-send-raw")
  // ...but the explicit C-c escape bindings still win over it.
  expect(editor.keymaps.lookup("C-c C-j")).toMatchObject({ status: "matched", command: "term-line-mode" })
  expect(editor.keymaps.lookup("C-c C-c")).toMatchObject({ status: "matched", command: "term-interrupt-subjob" })
})
