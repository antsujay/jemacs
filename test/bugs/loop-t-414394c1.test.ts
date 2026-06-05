import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { makeEditor } from "../plugins/helper"
import { addAdvice, clearAdvice } from "../../src/runtime/advice"
import { install, feed, sessions, termRawMap, type TermState } from "../../plugins/term"
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

// t-414394c1: rapid input 'echo' arrived at the pty as 'ecoh'. term-send-raw read
// editor.lastKeyEvent at execution time, but any await between dispatchKey()
// setting it and the command body running (before-advice, host queueing) lets a
// later key overwrite it. The triggering key must travel through CommandContext.
test("term-send-raw: key event is captured at dispatch, not read from mutable lastKeyEvent", async () => {
  const editor = makeEditor()
  install(editor)
  const buf = editor.scratch("*term*", "")
  buf.mode = "term"
  const pty = fakePty()
  sessions.set(buf, { pty, lines: [""], row: 0, col: 0 })
  editor.overridingTerminalLocalMap = termRawMap

  // Simulate the race: a before-advice yields, and while yielded the next key's
  // dispatchKey() overwrites editor.lastKeyEvent.
  addAdvice("term-send-raw", {
    before: async ({ editor }) => {
      await Promise.resolve()
      editor.lastKeyEvent = { name: "X", sequence: "X" }
    },
  })
  try {
    await editor.handleKey({ name: "e", sequence: "e" })
    await editor.handleKey({ name: "c", sequence: "c" })
    await editor.handleKey({ name: "h", sequence: "h" })
    await editor.handleKey({ name: "o", sequence: "o" })
    expect(pty.sent).toBe("echo")
  } finally {
    clearAdvice("term-send-raw")
  }
})

// t-df6b5b25: feed() now appends the shared-prefix delta, but a CR/BS that
// rewrites earlier columns falls through to setText(next, false), which still
// snapshots — every overwritten prompt line pushes a full-buffer undo frame.
test("term feed(): CR-overwrite path does not push an undo snapshot", () => {
  const buf = new BufferModel({ name: "*term*", kind: "scratch" })
  const state: TermState = { pty: fakePty(), lines: [""], row: 0, col: 0 }
  feed(state, buf, "spinner: -")
  feed(state, buf, "\rspinner: \\")
  feed(state, buf, "\rspinner: done\r\n")
  expect(buf.text).toBe("spinner: done\n")
  buf.undo()
  expect(buf.text).toBe("spinner: done\n")
})
