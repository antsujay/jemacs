import { test, expect } from "bun:test"
import { script, spans } from "../harness"

test("region span is suppressed when markActive is false", async () => {
  const editor = await script()
    .text("hello")
    .mark(0, false)
    .point(5)
    .done()
  expect(spans(editor).filter(s => s.face === "region")).toEqual([])
})
