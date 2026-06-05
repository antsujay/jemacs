import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { getMode } from "../../src/modes/mode"
import { makeEditor } from "../plugins/helper"
import { install, feed, sessions, type TermState } from "../../plugins/term"
import type { Pty } from "../../plugins/term/pty"

function fakePty(): Pty & { sent: string } {
  let sent = ""
  return {
    pid: 0,
    get sent() { return sent },
    write(d) { sent += d },
    resize() {}, onData() {}, onExit() {}, kill() {},
  }
}

test("term: space and uppercase reach term-send-raw via term-map", () => {
  const editor = makeEditor()
  install(editor)
  const map = getMode("term")!.keymap!
  // (a) ' ' was bound but normalizeSequence(' ') → '' so it never matched.
  expect(map.get("space")).toBe("term-send-raw")
  // (b) Uppercase A-Z were unbound and fell through to global self-insert.
  expect(map.get("S-a")).toBe("term-send-raw")
  expect(map.get("S-z")).toBe("term-send-raw")
})

test("term: term-send-raw uses args[0], not stale lastKeyEvent", async () => {
  const editor = makeEditor()
  install(editor)
  const buf = editor.scratch("*term*", "")
  const pty = fakePty()
  sessions.set(buf, { pty, lines: [""], row: 0, col: 0 })
  // (c) Under rapid input lastKeyEvent can be overwritten before the command
  // body runs. Simulate by leaving a stale event and passing the byte as arg.
  editor.lastKeyEvent = { name: "z", sequence: "z" }
  await editor.run("term-send-raw", ["A"])
  expect(pty.sent).toBe("A")
})

test("term: feed() does not push an undo snapshot per pty chunk", () => {
  const buf = new BufferModel({ name: "*term*", kind: "scratch" })
  const state: TermState = { pty: fakePty(), lines: [""], row: 0, col: 0 }
  // (d) setText() snapshots on every chunk; streaming output should not.
  feed(state, buf, "hello")
  feed(state, buf, " world\r\n")
  feed(state, buf, "$ ")
  expect(buf.text).toBe("hello world\n$ ")
  buf.undo()
  expect(buf.text).toBe("hello world\n$ ")
})
