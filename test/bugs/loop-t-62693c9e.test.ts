import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { keySeq } from "../harness"
import { install as installElectricPair } from "../../plugins/electric-pair"

// t-62693c9e: electric-pair's after-advice inserts the closer as a second
// mutation, so C-/ only removed `}` and a second C-/ was needed for `{`.
// One keystroke must be one undo unit. Fix: amalgamateUndo() after the
// closer insert (and after the skip-over deleteRange).

function setup() {
  const editor = makeEditor()
  installElectricPair(editor)
  const buffer = editor.currentBuffer
  buffer.setText("", false)
  buffer.point = 0
  editor.enableMinorMode("electric-pair-mode")
  return { editor, buffer }
}

test("typing `{` then C-/ removes both brace and auto-closer", async () => {
  const { editor, buffer } = setup()
  await keySeq(editor, "{")
  expect(buffer.text).toBe("{}")
  expect(buffer.point).toBe(1)
  await keySeq(editor, "C-/")
  expect(buffer.text).toBe("")
  expect(buffer.point).toBe(0)
})

test("skip-over: typing `)` over existing `)` is one undo unit", async () => {
  const { editor, buffer } = setup()
  buffer.setText(")", false)
  buffer.point = 0
  await keySeq(editor, ")")
  expect(buffer.text).toBe(")")
  expect(buffer.point).toBe(1)
  await keySeq(editor, "C-/")
  expect(buffer.text).toBe(")")
  expect(buffer.point).toBe(0)
})

test("redo after auto-pair undo restores both characters", async () => {
  const { editor, buffer } = setup()
  await keySeq(editor, "{")
  expect(buffer.text).toBe("{}")
  await keySeq(editor, "C-/")
  expect(buffer.text).toBe("")
  buffer.redo()
  expect(buffer.text).toBe("{}")
})

test("nested openers: each keystroke is its own undo unit", async () => {
  const { editor, buffer } = setup()
  await keySeq(editor, "(", "[", "{")
  expect(buffer.text).toBe("([{}])")
  await keySeq(editor, "C-/")
  expect(buffer.text).toBe("([])")
  await keySeq(editor, "C-/")
  expect(buffer.text).toBe("()")
  await keySeq(editor, "C-/")
  expect(buffer.text).toBe("")
})
