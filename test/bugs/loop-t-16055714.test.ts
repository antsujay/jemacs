import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { spans } from "../harness"
import { install as installSmerge, SMERGE_FACES } from "../../plugins/smerge"
import { install as installElectricPair } from "../../plugins/electric-pair"

const CONFLICT = [
  "<<<<<<< HEAD",
  "upper",
  "=======",
  "lower",
  ">>>>>>> branch",
  "",
].join("\n")

// t-16055714: smerge stores spans in buffer.locals but the display path never reads them.
test("smerge overlay spans reach the display model", () => {
  const editor = makeEditor()
  installSmerge(editor)
  const buffer = editor.scratch("conflict.txt", CONFLICT, "text")
  editor.enableMinorMode("smerge-mode", { buffer })
  const faces = new Set(spans(editor).map(s => s.face))
  expect(faces.has(SMERGE_FACES.markers)).toBe(true)
  expect(faces.has(SMERGE_FACES.upper)).toBe(true)
  expect(faces.has(SMERGE_FACES.lower)).toBe(true)
})

// t-62693c9e: electric-pair's auto-closer lands as a second undo record.
test("electric-pair auto-pair is a single undo unit", async () => {
  const editor = makeEditor()
  installElectricPair(editor)
  const buffer = editor.currentBuffer
  buffer.setText("", false)
  buffer.point = 0
  editor.enableMinorMode("electric-pair-mode")
  await editor.handleKey({ name: "{", sequence: "{" })
  expect(buffer.text).toBe("{}")
  buffer.undo()
  expect(buffer.text).toBe("")
})

test("electric-pair skip-over is a single undo unit", async () => {
  const editor = makeEditor()
  installElectricPair(editor)
  const buffer = editor.currentBuffer
  buffer.setText(")", false)
  buffer.point = 0
  editor.enableMinorMode("electric-pair-mode")
  await editor.handleKey({ name: ")", sequence: ")" })
  expect(buffer.text).toBe(")")
  expect(buffer.point).toBe(1)
  buffer.undo()
  expect(buffer.text).toBe(")")
  expect(buffer.point).toBe(0)
})
