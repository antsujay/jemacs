import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { feed, makeXTerm, type TermSession } from "../../plugins/term-v2"
import type { Pty } from "../../plugins/term/pty"

const feedAsync = (s: TermSession, b: BufferModel, c: string) =>
  new Promise<void>(r => feed(s, b, c, r))

test("term-v2 feed: streaming output uses append(), not setText() snapshot-per-chunk", async () => {
  const buffer = new BufferModel({ name: "*term*", kind: "scratch" })
  const session: TermSession = { pty: {} as Pty, xt: makeXTerm(10, 40), rows: 10, cols: 40 }
  for (const c of ["a\r\n", "b\r\n", "c\r\n"]) await feedAsync(session, buffer, c)
  expect(buffer.text).toBe("a\nb\nc\n")
  buffer.undo()
  // bug: setText() snapshotted each chunk, so undo() rewinds to "a\nb\n"
  expect(buffer.text).toBe("a\nb\nc\n")
})
