import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { feed, makeXTerm, resizeSession, attachSession, type TermSession } from "../../plugins/term-v2"
import type { Pty } from "../../plugins/term/pty"

// t-5702e524: "htop jank — no SIGWINCH on window-change, alt-screen buffer not
// read" (journal 06-05). Duplicate of t-e16ea5b7, which already landed the fix:
// pty.resize() sends SIGWINCH explicitly, term-v2 hooks
// window-configuration-change-hook → resizeSession, and renderTerminal reads
// xt.buffer.active. See loop-t-e16ea5b7.test.ts for the unit coverage of each
// piece. This file pins the composed htop scenario as a regression guard:
// enter alt-screen → split window (resize) → redraw → exit.

const feedAsync = (s: TermSession, b: BufferModel, c: string) =>
  new Promise<void>(r => feed(s, b, c, r))

function fakePty() {
  const calls: Array<[number, number]> = []
  const pty: Pty = {
    pid: 0, write() {}, onData() {}, onExit() {}, kill() {},
    resize(rows, cols) { calls.push([rows, cols]) },
  }
  return { pty, calls }
}

test("htop scenario: resize while in alternate screen, then exit", async () => {
  const buf = new BufferModel({ name: "*term*", kind: "scratch" })
  const { pty, calls } = fakePty()
  const session: TermSession = { pty, xt: makeXTerm(6, 20), rows: 6, cols: 20 }
  attachSession(buf, session)

  await feedAsync(session, buf, "$ htop\r\n")
  // htop enters the alternate screen and paints a frame.
  await feedAsync(session, buf, "\x1b[?1049h\x1b[2J\x1b[H  PID  CPU%\r\n  123   4.2")
  expect(session.xt.buffer.active.type).toBe("alternate")
  expect(buf.text).toBe("  PID  CPU%\n  123   4.2")

  // User splits the window: resizeSession must push the new geometry to the
  // pty (so htop gets SIGWINCH) and to the xterm grid, without leaving the
  // alternate screen.
  resizeSession(buf, 4, 12)
  expect(calls.at(-1)).toEqual([4, 12])
  expect(session.xt.rows).toBe(4)
  expect(session.xt.buffer.active.type).toBe("alternate")

  // htop's SIGWINCH handler repaints at the new size.
  await feedAsync(session, buf, "\x1b[2J\x1b[HPID CPU\r\n123 4.2")
  expect(buf.text).toBe("PID CPU\n123 4.2")

  // q: htop exits the alternate screen; the normal scrollback (from before
  // ?1049h) survives the intervening resize.
  await feedAsync(session, buf, "\x1b[?1049l")
  expect(session.xt.buffer.active.type).toBe("normal")
  expect(buf.text).toBe("$ htop\n")
})
