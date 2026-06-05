import { test, expect } from "bun:test"
import { script } from "../harness"

// t-11bf2d — bare M-- delivers prefixArgument=null via the real keyboard path.
// 17208eb made delete-char/kill-word sign-aware (see loop-t-e8584a11), but
// PrefixArgumentState.peek() returned null for negative-with-no-digits, and
// editor.run() consumed+cleared the prefix state before negative-argument /
// digit-argument bodies ran. These tests drive handleKey, not ed.prefixArg.*.

test("M-- C-d delivers -1 to delete-char (deletes backward)", async () => {
  await script()
    .text("hello").point(5)
    .keys("M--", "C-d")
    .expect.text("hell").expect.point(4)
    .done()
})

test("M-- M-d at EOL delivers -1 to kill-word (kills backward)", async () => {
  await script()
    .text("foo bar").point(7)
    .keys("M--", "M-d")
    .expect.text("foo ").expect.point(4)
    .done()
})

test("C-u 1 2 builds 12 (digit-argument does not clear prior digits)", async () => {
  await script()
    .text("abcdefghijklmnop").point(0)
    .keys("C-u", "1", "2", "C-f")
    .expect.point(12)
    .done()
})

test("PrefixArgumentState: bare negative peek/isActive/describe are coherent", async () => {
  const ed = await script().done()
  ed.prefixArg.toggleNegative()
  expect(ed.prefixArg.peek()).toBe(-1)
  expect(ed.prefixArg.isActive()).toBe(true)
  expect(ed.prefixArg.describe()).toBe("-1")
})
