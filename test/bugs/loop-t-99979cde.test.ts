import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { defvar, getCustom, getCustomVariable } from "../../src/runtime/custom"

test("t-99979cde: defvar array infers sexp type and customize round-trips via JSON", async () => {
  const editor = makeEditor()
  defvar("t-99979cde-count-format", ["%-6s ", "%s/%s"], "test array var")

  expect(getCustomVariable("t-99979cde-count-format")?.type).not.toBe("string")

  await editor.run("customize-set-variable", ["t-99979cde-count-format", '["%-6s ","%s/%s"]'])
  const value = getCustom<unknown>("t-99979cde-count-format")
  expect(Array.isArray(value)).toBe(true)
  expect((value as string[])[0]).toBe("%-6s ")
})
