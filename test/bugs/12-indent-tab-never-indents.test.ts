import { test } from "bun:test"
import { script } from "../harness"
import { defineMode } from "../../src/modes/mode"

test("indent-for-tab-command indents when no completion applies", async () => {
  defineMode({ name: "indent-test", indentLine: b => b.setText("  " + b.text) })
  await script()
    .mode("indent-test")
    .text("x")
    .run("indent-for-tab-command")
    .expect.text("  x")
    .done()
})
