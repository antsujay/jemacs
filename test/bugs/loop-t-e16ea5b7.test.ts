import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { getHooks } from "../../src/kernel/hooks"
import { makeEditor } from "../plugins/helper"
import * as termV2 from "../../plugins/term-v2"
import { install, feed, makeXTerm, type TermSession } from "../../plugins/term-v2"
import { spawnPty, type Pty } from "../../plugins/term/pty"

const feedAsync = (s: TermSession, b: BufferModel, c: string) =>
  new Promise<void>(r => feed(s, b, c, r))

function fakePty() {
  const calls: Array<[number, number]> = []
  const pty: Pty = {
    pid: 0,
    write() {}, onData() {}, onExit() {}, kill() {},
    resize(rows, cols) { calls.push([rows, cols]) },
  }
  return { pty, calls }
}

// t-e16ea5b7 (1): pty.resize() was called once at spawn and never again, so
// fullscreen apps (htop) drew at a stale 30×100 after a window split. Fix:
// install() hooks window-configuration-change-hook → resizeSession(), which
// pushes the new geometry to both the pty (TIOCSWINSZ ⇒ SIGWINCH) and the
// headless xterm grid.
test("window-configuration-change-hook resizes the pty and xterm grid", async () => {
  const editor = makeEditor()
  install(editor)

  const buf = editor.scratch("*term*<bash>", "")
  buf.mode = "term"
  const { pty, calls } = fakePty()
  const session: TermSession = { pty, xt: makeXTerm(30, 100), rows: 30, cols: 100 }
  termV2.attachSession(buf, session)
  expect(termV2.sessionFor(buf)).toBe(session)

  // resizeSession is the unit; the hook is the wiring.
  termV2.resizeSession(buf, 18, 60)
  expect(calls.at(-1)).toEqual([18, 60])
  expect(session.rows).toBe(18)
  expect(session.cols).toBe(60)
  expect(session.xt.rows).toBe(18)
  expect(session.xt.cols).toBe(60)

  // No-op when dims are unchanged (don't spam SIGWINCH on every redisplay).
  termV2.resizeSession(buf, 18, 60)
  expect(calls.length).toBe(1)

  // install() registered a listener on the Emacs-named hook; the display layer
  // stashes the leaf's body rows/cols on the buffer before firing it.
  expect(getHooks("window-configuration-change-hook").length).toBeGreaterThan(0)
  buf.locals.set("window-body-rows", 12)
  buf.locals.set("window-body-cols", 48)
  await editor.runHook("window-configuration-change-hook", buf)
  expect(calls.at(-1)).toEqual([12, 48])
  expect(session.xt.rows).toBe(12)
})

// t-e16ea5b7 (2): CSI ?1049h flips xterm to its alternate buffer. renderTerminal
// reads xt.buffer.active, which @xterm/headless already swaps on ?1049h/l, so
// this is a regression guard: the BufferModel must mirror the alt grid while
// fullscreen and snap back to the preserved normal scrollback on exit.
test("alternate-screen (?1049h/l): render follows xt.buffer.active", async () => {
  const buffer = new BufferModel({ name: "*term*", kind: "scratch" })
  const session: TermSession = { pty: fakePty().pty, xt: makeXTerm(5, 20), rows: 5, cols: 20 }

  await feedAsync(session, buffer, "$ htop\r\n")
  expect(buffer.text).toBe("$ htop\n")

  // Enter alternate screen, clear, draw a fullscreen frame.
  await feedAsync(session, buffer, "\x1b[?1049h\x1b[2J\x1b[H  PID  CPU%\r\n  123   4.2")
  expect(session.xt.buffer.active.type).toBe("alternate")
  expect(buffer.text).toBe("  PID  CPU%\n  123   4.2")
  expect(buffer.text).not.toContain("$ htop") // normal scrollback hidden, not blended

  // Leave alternate screen: normal buffer (with scrollback) is restored verbatim.
  await feedAsync(session, buffer, "\x1b[?1049l")
  expect(session.xt.buffer.active.type).toBe("normal")
  expect(buffer.text).toBe("$ htop\n")
})

// t-e16ea5b7 (1, pty side): Bun.spawn doesn't make the slave the controlling
// tty, so the kernel won't auto-SIGWINCH on TIOCSWINSZ. pty.resize() must
// signal the child explicitly or htop never repaints.
test("pty.resize() delivers SIGWINCH and the child observes the new winsize", async () => {
  const pty = spawnPty(
    ["bash", "-c",
     "trap 'echo WINCH $(stty size)' WINCH; echo ready $(stty size); " +
     "for i in $(seq 20); do sleep 0.1; done"],
    { rows: 24, cols: 80 },
  )
  let out = ""
  pty.onData(c => { out += c })
  const waitFor = async (re: RegExp, ms: number) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (re.test(out)) return
      await new Promise(r => setTimeout(r, 30))
    }
    throw new Error(`timeout waiting for ${re}; out=${JSON.stringify(out)}`)
  }
  try {
    await waitFor(/ready 24 80/, 2000)
    pty.resize(10, 40)
    await waitFor(/WINCH 10 40/, 2000)
  } finally {
    pty.kill()
  }
})
