import { expect, test } from "bun:test"
import { BufferModel } from "../src/kernel/buffer"
import { Editor } from "../src/kernel/editor"
import { installDefaultModes } from "../src/modes/default-modes"
import { getBufferFaceRemap } from "../src/runtime/faces"
import { enterMode } from "../src/modes/mode"
import { installMarkdownMode, markdownCalcIndents, markdownIndentLine } from "../src/modes/markdown"
import { treeSitterFontLock } from "../src/modes/tree-sitter"

test("inferMode selects markdown and gfm from file names", () => {
  expect(new BufferModel({ name: "x.md" }).mode).toBe("markdown")
  expect(new BufferModel({ name: "README.md", path: "/proj/README.md" }).mode).toBe("gfm")
})

test("tree-sitter font-lock highlights markdown structure", () => {
  const text = "# Title\n\n**bold** and `code`\n\n> quote\n"
  const spans = treeSitterFontLock("markdown", new BufferModel({ name: "t.md", text, mode: "markdown" }))
  expect(spans.some(span => span.face === "type")).toBe(true)
  expect(spans.some(span => span.face === "builtin")).toBe(true)
  expect(spans.some(span => span.face === "comment")).toBe(true)
})

test("markdown-indent-line follows previous list marker", () => {
  const text = "- item one\n"
  const buffer = new BufferModel({ name: "list.md", text, mode: "markdown" })
  buffer.point = text.length
  markdownIndentLine(buffer)
  expect(buffer.text).toBe("- item one\n  ")
})

test("markdownCalcIndents includes previous line indent", () => {
  const text = "    nested\n"
  const lineStart = text.indexOf("nested")
  const indents = markdownCalcIndents(text, lineStart)
  expect(indents).toContain(4)
})

test("markdown-mode keymap binds RET to markdown-enter-key", () => {
  installDefaultModes()
  const editor = new Editor()
  installMarkdownMode(editor)
  const buffer = new BufferModel({ name: "doc.md", text: "", mode: "markdown" })
  editor.addBuffer(buffer)
  editor.currentBufferId = buffer.id
  const result = editor.keymaps.lookup("return")
  expect(result.status).toBe("matched")
  expect(result.status === "matched" ? result.command : "").toBe("markdown-enter-key")
})

test("markdown-mode onEnter applies proportional default face remap", () => {
  installDefaultModes()
  installMarkdownMode(new Editor())
  const buffer = new BufferModel({ name: "doc.md", text: "# Title", mode: "text" })
  enterMode(buffer, "markdown")
  expect(getBufferFaceRemap(buffer, "default")?.family).toBe("Helvetica Neue")
  expect(getBufferFaceRemap(buffer, "default")?.height).toBe(200)
})
