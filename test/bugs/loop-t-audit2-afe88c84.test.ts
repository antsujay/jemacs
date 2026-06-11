import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { getTextScaleAmount } from "../../lisp/misc"

// t-audit2-afe88c84 — text-scale-increase / text-scale-decrease silently no-op
// when called with no prefix arg and no positional arg: `prefixArgument ?? Number(args[0])`
// yields NaN, the isFinite guard returns early. Emacs default step is 1.

test("text-scale-increase defaults to step 1 with no prefix arg", async () => {
  const editor = makeEditor()
  const buffer = editor.currentBuffer
  expect(getTextScaleAmount(buffer)).toBe(0)
  await editor.run("text-scale-increase")
  expect(getTextScaleAmount(buffer)).toBe(1)
  await editor.run("text-scale-increase")
  expect(getTextScaleAmount(buffer)).toBe(2)
})

test("text-scale-decrease defaults to step 1 with no prefix arg", async () => {
  const editor = makeEditor()
  const buffer = editor.currentBuffer
  await editor.run("text-scale-decrease")
  expect(getTextScaleAmount(buffer)).toBe(-1)
  await editor.run("text-scale-decrease")
  expect(getTextScaleAmount(buffer)).toBe(-2)
})

test("text-scale-increase still honours explicit prefix arg", async () => {
  const editor = makeEditor()
  const buffer = editor.currentBuffer
  editor.prefixArg.addDigit(3)
  await editor.run("text-scale-increase")
  expect(getTextScaleAmount(buffer)).toBe(3)
  // explicit 0 resets — must not be eaten by the new default
  editor.prefixArg.addDigit(0)
  await editor.run("text-scale-increase")
  expect(getTextScaleAmount(buffer)).toBe(0)
})

// t-audit2-1e37b8b3 (merged) — call-last-kbd-macro ignored prefixArgument;
// C-u N C-x e should repeat the macro N times.

test("call-last-kbd-macro repeats prefixArgument times", async () => {
  const editor = makeEditor()
  const buffer = editor.currentBuffer
  buffer.setText("")
  editor.lastKbdMacro = ["x"]
  editor.prefixArg.addDigit(3)
  await editor.run("call-last-kbd-macro")
  expect(buffer.text).toBe("xxx")
})

test("call-last-kbd-macro runs once with no prefix arg", async () => {
  const editor = makeEditor()
  const buffer = editor.currentBuffer
  buffer.setText("")
  editor.lastKbdMacro = ["a", "b"]
  await editor.run("call-last-kbd-macro")
  expect(buffer.text).toBe("ab")
})
