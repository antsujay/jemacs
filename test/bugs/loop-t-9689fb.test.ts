import { expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { makeEditor } from "../plugins/helper"
import { install as installTerm } from "../../plugins/term"
import {
  install,
  attachSession,
  makeXTerm,
  feed,
  type TermSession,
} from "../../plugins/term-v2"
import type { Pty } from "../../plugins/term/pty"

// t-9689fb — term-v2 input/render races under opentui-host's fire-and-forget
// keypress dispatch (Layer-3 repro @0054822).
//
// (1) Burst reorder: tmux send-keys -l hello → zsh ran "hlleo". opentui's
//     keyInput emits each key synchronously without awaiting the async
//     listener, so five term-send-raw bodies each call pty.write() in one
//     tick. pty.write() is fs.write(master, …) — async, libuv-thread-pool —
//     and concurrent writes to the same fd are not ordered, so five 1-byte
//     writes land interleaved at the pty. Fix: coalesce same-tick bytes into
//     one pty.write().
//
// (2) One-behind render: type h, wait 300ms → cursor advanced but h not
//     drawn; type i → h appears. pty echo → onData → feed → xt.write is
//     async (setTimeout), and the buffer mirror + editor.changed live in its
//     callback. Nothing awaits that callback, so the host redraw fired by the
//     keystroke's command:term-send-raw races a still-stale buffer, and the
//     term-output redraw scheduled from inside xt.write's setTimeout can be
//     dropped by opentui's frame coalescing. Fix: feed() maintains an
//     awaitable settle chain on the session so the mirror is observably
//     complete before the next chunk (and so install()'s onData can chain
//     editor.changed onto it instead of voiding).

class FakePty implements Pty {
  pid = 0
  /** pty.write() calls in submission order — the real pty (fs.write) does NOT
   *  preserve this order on the wire when calls overlap. */
  writes: string[] = []
  write(d: string) { this.writes.push(d) }
  resize() {}
  onData() {}
  onExit() {}
  kill() {}
}

function setup() {
  const editor = makeEditor()
  installTerm(editor)
  install(editor)
  const buf = editor.scratch("*term*", "")
  buf.mode = "term"
  editor.switchToBuffer(buf.id)
  const pty = new FakePty()
  const session: TermSession = { pty, xt: makeXTerm(8, 40), rows: 8, cols: 40 }
  attachSession(buf, session)
  return { editor, buf, pty, session }
}

test("term-v2: burst keys reach the pty as one ordered write", async () => {
  const { editor, pty } = setup()
  await editor.run("term-char-mode")

  // opentui-host.ts:109 — EventEmitter calls the async listener without
  // awaiting, so a five-byte stdin read fires five overlapping handleKey()s.
  const keyInput = new EventEmitter()
  keyInput.on("keypress", async key => { await editor.handleKey(key) })
  for (const c of "hello") keyInput.emit("keypress", { name: c, sequence: c })
  await new Promise(r => setTimeout(r, 0))

  // Five separate fs.write()s is the bug; one coalesced write is the only
  // ordering guarantee term-v2 can give without owning pty.ts.
  expect(pty.writes).toEqual(["hello"])
})

test("term-v2: feed() exposes an awaitable settle chain (one-behind)", async () => {
  const { buf, session } = setup()

  // Two echo chunks back-to-back, like zsh redrawing its prompt after a key.
  feed(session, buf, "$ ")
  feed(session, buf, "h")

  // Before fix: nothing to await — xt.write's callback is on setTimeout, so
  // a microtask-level await (Promise.resolve / undefined) observes a stale
  // buffer and the host paints one-behind.
  expect(session.settled).toBeInstanceOf(Promise)
  await session.settled
  expect(buf.text).toBe("$ h")
  // Chunks were applied in arrival order across the chain.
  expect(buf.point).toBe(3)
})
