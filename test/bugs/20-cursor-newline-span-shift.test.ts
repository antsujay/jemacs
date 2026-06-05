import { expect, test } from "bun:test"
import { script, display } from "../harness"
import { defineMode } from "../../src/modes/mode"

test("cursor at newline does not shift later font-lock spans", async () => {
  defineMode({ name: "bug20", fontLock: () => [{ start: 3, end: 5, face: "keyword" }] })
  const ed = await script().text("ab\ncd").point(2).mode("bug20").done()
  const win = display(ed).windows
  const chunks = win.kind === "leaf" ? win.pane.body.chunks : []
  expect(chunks.find(c => c.bold)?.text).toBe("cd")
})
