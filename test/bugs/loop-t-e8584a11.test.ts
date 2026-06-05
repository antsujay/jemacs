import { test, expect } from "bun:test"
import { script } from "../harness"

// t-e8584a11 — forward-word: negative prefix + Unicode word constituents.
// Headline forward-word/backward-word are pinned in loop-forward-word-prefix;
// these cover the kill-word/delete-char paths that share the two defects.

test("kill-word with negative prefix kills backward |N| words", async () => {
  await script()
    .text("foo bar baz").point(11)
    .do(ed => { ed.prefixArg.addDigit(2); ed.prefixArg.toggleNegative() })
    .run("kill-word")
    .expect.text("foo ").expect.point(4)
    .done()
})

test("kill-word treats Unicode letters/marks as word constituents", async () => {
  await script()
    .text("café naïve").point(0)
    .run("kill-word")
    .expect.text(" naïve")
    .done()
})

test("backward-kill-word treats Unicode letters/marks as word constituents", async () => {
  await script()
    .text("foo naïve").point("foo naïve".length)
    .run("backward-kill-word")
    .expect.text("foo ")
    .done()
})

test("delete-char with negative prefix deletes backward |N| chars", async () => {
  await script()
    .text("hello").point(5)
    .do(ed => { ed.prefixArg.addDigit(3); ed.prefixArg.toggleNegative() })
    .run("delete-char")
    .expect.text("he").expect.point(2)
    .done()
})

// t-817ee762 — kill-line: prefix arg / blank-tail / kill-append.
// N>0, blank-tail, and consecutive-append are pinned in
// loop-kill-line-semantics; these cover the 0/negative branches and the
// prepend direction for backward kills.

test("kill-line with prefix 0 kills back to beginning of line", async () => {
  await script()
    .text("hello world\nnext").point(5)
    .do(ed => ed.prefixArg.addDigit(0))
    .run("kill-line")
    .expect.text(" world\nnext").expect.point(0)
    .done()
})

test("kill-line with negative prefix kills |N| lines backward", async () => {
  await script()
    .text("a\nb\nc\nd").point(6)
    .do(ed => { ed.prefixArg.addDigit(2); ed.prefixArg.toggleNegative() })
    .run("kill-line")
    .expect.text("a\nd").expect.point(2)
    .done()
})

test("backward kill prepends so consecutive C-k C-u 0 C-k yanks in order", async () => {
  const ed = await script()
    .text("LR").point(1)
    .run("kill-line")                      // forward: "R"
    .do(ed => ed.prefixArg.addDigit(0))
    .run("kill-line")                      // backward: "L" — Emacs kill-append prepends
    .run("yank")
    .done()
  expect(ed.currentBuffer.text).toBe("LR")
})
