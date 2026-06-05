import { expect, test } from "bun:test"
import { defvar, getCustom, setCustom } from "../../src/runtime/custom"

test("defvar does not overwrite an already-bound variable", () => {
  defvar("r2-defvar-a", "first")
  defvar("r2-defvar-a", "second")
  expect(getCustom("r2-defvar-a")).toBe("first")
})

test("defvar preserves a value set via setCustom", () => {
  defvar("r2-defvar-b", "init")
  setCustom("r2-defvar-b", "user")
  defvar("r2-defvar-b", "init")
  expect(getCustom("r2-defvar-b")).toBe("user")
})
