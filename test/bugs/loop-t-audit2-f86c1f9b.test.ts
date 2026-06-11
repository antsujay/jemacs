import { test, expect } from "bun:test"
import { script } from "../harness"

const sh = "a() {\n  :\n}\n\nb() {\n  :\n}\n\nc() {\n  :\n}\n"

test("beginning-of-defun honors prefix argument as repeat count", async () => {
  await script()
    .text(sh).mode("sh-mode")
    .point(sh.length)
    .do(ed => { ed.prefixArg.addDigit(2) })
    .run("beginning-of-defun")
    .expect.that((_, b) => expect(b.point).toBe(sh.indexOf("b()")))
    .done()
})

test("end-of-defun honors prefix argument (negative reverses direction)", async () => {
  await script()
    .text(sh).mode("sh-mode")
    .point(sh.length)
    .do(ed => { ed.prefixArg.addDigit(2); ed.prefixArg.toggleNegative() })
    .run("end-of-defun")
    .expect.that((_, b) => expect(b.point).toBe(sh.indexOf("b()")))
    .done()
})
