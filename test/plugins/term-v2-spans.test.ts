import { expect, test, describe } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { modeFeature } from "../../src/modes/mode"
import { makeEditor } from "./helper"
import {
  install,
  feed,
  renderTerminal,
  makeXTerm,
  termSpans,
  ANSI_FACES,
  TERM_SPANS_LOCAL,
  type TermSession,
} from "../../plugins/term-v2"
import type { Pty } from "../../plugins/term/pty"

function fakePty(): Pty {
  return { pid: 0, write() {}, resize() {}, onData() {}, onExit() {}, kill() {} }
}

function makeSession(rows = 10, cols = 40): { session: TermSession; buffer: BufferModel } {
  const buffer = new BufferModel({ name: "*term*", kind: "scratch" })
  buffer.mode = "term"
  const session: TermSession = { pty: fakePty(), xt: makeXTerm(rows, cols), rows, cols }
  return { session, buffer }
}

function feedAsync(s: TermSession, b: BufferModel, chunk: string): Promise<void> {
  return new Promise(resolve => feed(s, b, chunk, resolve))
}

function writeAsync(xt: ReturnType<typeof makeXTerm>, chunk: string): Promise<void> {
  return new Promise(resolve => xt.write(chunk, resolve))
}

describe("term-v2: SGR → TextSpan", () => {
  test("renderTerminal emits a span per coloured run", async () => {
    const xt = makeXTerm(5, 40)
    await writeAsync(xt, "plain \x1b[31mred\x1b[0m \x1b[32mgreen\x1b[0m tail")
    const { text, spans } = renderTerminal(xt)
    expect(text).toBe("plain red green tail")
    // Exactly the two coloured words are spanned; default text is left bare.
    expect(spans).toEqual([
      { start: 6, end: 9, face: ANSI_FACES[1] },   // "red"
      { start: 10, end: 15, face: ANSI_FACES[2] }, // "green"
    ])
  })

  test("adjacent same-colour cells coalesce; bright variants map to base face", async () => {
    const xt = makeXTerm(5, 40)
    await writeAsync(xt, "\x1b[34mblue\x1b[94mBLUE\x1b[0m")
    const { text, spans } = renderTerminal(xt)
    expect(text).toBe("blueBLUE")
    expect(spans).toEqual([{ start: 0, end: 8, face: ANSI_FACES[4] }])
  })

  test("bold-only and bg-only map to keyword/region faces", async () => {
    const xt = makeXTerm(5, 40)
    await writeAsync(xt, "\x1b[1mbold\x1b[0m \x1b[44mbg\x1b[0m")
    const { text, spans } = renderTerminal(xt)
    expect(text).toBe("bold bg")
    expect(spans).toEqual([
      { start: 0, end: 4, face: "keyword" },
      { start: 5, end: 7, face: "region" },
    ])
  })

  test("span offsets are correct across multiple lines", async () => {
    const xt = makeXTerm(5, 40)
    await writeAsync(xt, "line0\r\n--\x1b[31mERR\x1b[0m--\r\n")
    const { text, spans } = renderTerminal(xt)
    expect(text).toBe("line0\n--ERR--\n")
    expect(spans).toHaveLength(1)
    const sp = spans[0]!
    expect(text.slice(sp.start, sp.end)).toBe("ERR")
    expect(sp.face).toBe(ANSI_FACES[1])
  })

  test("feed() stashes spans in buffer.locals[term-spans]", async () => {
    const { session, buffer } = makeSession()
    expect(termSpans(buffer)).toEqual([])
    await feedAsync(session, buffer, "$ \x1b[32mok\x1b[0m\r\n")
    expect(buffer.text).toBe("$ ok\n")
    const spans = termSpans(buffer)
    expect(spans).toEqual([{ start: 2, end: 4, face: ANSI_FACES[2] }])
    expect(buffer.locals.get(TERM_SPANS_LOCAL)).toBe(spans)
  })

  test("term mode fontLock returns the stored spans (display-model wiring)", async () => {
    const editor = makeEditor()
    install(editor)
    const { session, buffer } = makeSession()
    await feedAsync(session, buffer, "\x1b[31mred\x1b[0m\r\n")
    const fontLock = modeFeature("term", "fontLock")
    expect(fontLock).toBeDefined()
    expect(fontLock!(buffer)).toEqual([{ start: 0, end: 3, face: ANSI_FACES[1] }])
    expect(editor.fontLock(buffer)).toEqual([{ start: 0, end: 3, face: ANSI_FACES[1] }])
  })

  test("256-colour / truecolor fall back to a visible face", async () => {
    const xt = makeXTerm(5, 40)
    await writeAsync(xt, "\x1b[38;5;208mhi\x1b[0m \x1b[38;2;10;20;30mrgb\x1b[0m")
    const { spans } = renderTerminal(xt)
    expect(spans.map(s => s.face)).toEqual(["builtin", "builtin"])
  })
})
