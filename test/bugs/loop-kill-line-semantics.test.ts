import { test, expect } from "bun:test"
import { script } from "../harness"

test("kill-line with prefix N kills N whole lines including newlines", async () => {
  await script()
    .text("a\nb\nc\nd").point(0)
    .do(ed => { ed.prefixArg.addDigit(2) })
    .run("kill-line")
    .expect.text("c\nd")
    .done()
})

test("kill-line at blank tail kills the newline", async () => {
  await script()
    .text("foo  \nbar").point(3)
    .run("kill-line")
    .expect.text("foobar")
    .done()
})

test("consecutive kill-line appends to kill-ring head", async () => {
  await script()
    .text("a\nb\nc\n").point(0)
    .run("kill-line").run("kill-line").run("kill-line")
    .run("yank")
    .expect.that((_, b) => expect(b.text.startsWith("a\nb")).toBe(true))
    .done()
})
