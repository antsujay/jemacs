import { expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { makeEditor } from "../plugins/helper"

// t-8c81ab4c: linum-mode is global, so the gutter renders in magit-status,
// *compilation*, *grep*, *dogfood*, *Buffer List* — meaningless there and
// shoves content right. Per the report, linum should default OFF for non-file
// buffers (kind !== "file"); a buffer can still opt in explicitly.
//
// Fix lives in src/modes/linum-mode.ts: onEnable gates editor.showLineNumbers
// on `kind === "file" || buffer.minorModes.has("linum-mode")`. The kernel has
// no per-buffer suppression of a global minor mode, so the gate is installed on
// the editor instance from onEnable rather than touching editor.ts.

test("t-8c81ab4c: linum gutter defaults off for non-file buffers", () => {
  const editor = makeEditor() // user.ts enables linum-mode globally on startup

  // file-visiting buffer: gutter on
  const file = editor.addBuffer(new BufferModel({ name: "foo.ts", path: "/tmp/foo.ts", kind: "file" }))
  expect(editor.showLineNumbers(file)).toBe(true)

  // *scratch* opted in via the enable that user.ts ran with it current
  const scratch = [...editor.buffers.values()].find(b => b.name === "*scratch*")!
  expect(editor.showLineNumbers(scratch)).toBe(true)

  // special buffers from the bug report — created the way the plugins create them
  const grep = editor.scratch("*grep*", "foo.ts:1:hit\n", "text")
  grep.kind = "grep"
  expect(editor.showLineNumbers(grep)).toBe(false)

  const compilation = editor.scratch("*compilation*", "make\n", "text")
  expect(editor.showLineNumbers(compilation)).toBe(false)

  const bufferList = editor.addBuffer(new BufferModel({ name: "*Buffer List*", kind: "scratch", mode: "buffer-list" }))
  expect(editor.showLineNumbers(bufferList)).toBe(false)

  const magit = editor.scratch("magit: repo", "Head: main\n", "text")
  expect(editor.showLineNumbers(magit)).toBe(false)

  // explicit per-buffer opt-in still works
  editor.enableMinorMode("linum-mode", { buffer: grep })
  expect(editor.showLineNumbers(grep)).toBe(true)
})
