import { expect, test } from "bun:test"
import type { KeyEventLike } from "../../src/kernel/keymap"
import { modes } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"
import { install, sessions } from "../../plugins/term"
import type { Pty } from "../../plugins/term/pty"

// t-92f9a440: term-map only enumerated lowercase a-z, so uppercase (which
// keyToken renders as S-<letter>) and shifted punctuation fell through to
// self-insert and never reached the pty. Repro: `echo Yy` arrived as `echoy`.
// Fixed alongside t-ba640ab6; this test drives the full handleKey path and
// asserts the pty receives every byte.

function fakePty(): Pty & { sent: string } {
  let sent = ""
  return {
    pid: 0,
    get sent() { return sent },
    write(d) { sent += d },
    resize() {}, onData() {}, onExit() {}, kill() {},
  }
}

test("term: 'echo Yy!' reaches the pty intact via handleKey", async () => {
  modes.delete("term")
  const editor = makeEditor()
  install(editor)
  const buf = editor.scratch("*term*", "")
  buf.mode = "term"
  const pty = fakePty()
  sessions.set(buf, { pty, lines: [""], row: 0, col: 0 })

  const keys: KeyEventLike[] = [
    { name: "e", sequence: "e" },
    { name: "c", sequence: "c" },
    { name: "h", sequence: "h" },
    { name: "o", sequence: "o" },
    { name: "space", sequence: " " },
    { name: "y", sequence: "Y", shift: true },
    { name: "y", sequence: "y" },
    { name: "!", sequence: "!", shift: true },
    { name: "enter", sequence: "\r" },
  ]
  for (const k of keys) {
    const r = await editor.handleKey(k)
    expect(r, `key ${JSON.stringify(k)} dispatched`).toEqual({ status: "command", command: "term-send-raw" })
  }
  expect(pty.sent).toBe("echo Yy!\r")
  // Nothing should have self-inserted into the buffer.
  expect(buf.text).toBe("")
})
