import { test, expect } from "bun:test"
import { script } from "../harness"

test("forward-word with negative prefix moves backward |N| words", async () => {
  await script()
    .text("foo bar baz").point(11)
    .do(ed => { ed.prefixArg.addDigit(2); ed.prefixArg.toggleNegative() })
    .run("forward-word")
    .expect.point(4)
    .done()
})

test("backward-word with negative prefix moves forward |N| words", async () => {
  await script()
    .text("foo bar baz").point(0)
    .do(ed => { ed.prefixArg.addDigit(2); ed.prefixArg.toggleNegative() })
    .run("backward-word")
    .expect.point(7)
    .done()
})

test("forward-word treats Unicode letters as word constituents", async () => {
  await script()
    .text("héllo wörld").point(0)
    .run("forward-word")
    .expect.that((_, b) => expect(b.point).toBe("héllo".length))
    .done()
})
