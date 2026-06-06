import { describe, expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"
import { makeEditor } from "./helper"
import { keySeq } from "../harness"
import { getBufferFaceRemap } from "../../src/runtime/faces"
import { enterMode } from "../../src/modes/mode"
import {
  install,
  markdownCalcIndents,
  markdownDisplayFilter,
  markdownIndentLine,
  markdownParseHeadings,
  MARKDOWN_FOLDED_LOCAL,
} from "../../plugins/markdown"
import { treeSitterFontLock } from "../../src/modes/tree-sitter"

const DOC = [
  "# Top",
  "intro",
  "## Child",
  "body",
  "### Grand",
  "deep",
].join("\n")

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

test("markdown-mode keymap binds RET to clear-whitespace-and-newline-and-indent", () => {
  const editor = makeEditor()
  install(editor)
  const buffer = new BufferModel({ name: "doc.md", text: "", mode: "markdown" })
  editor.addBuffer(buffer)
  editor.currentBufferId = buffer.id
  const result = editor.keymaps.lookup("return")
  expect(result.status).toBe("matched")
  expect(result.status === "matched" ? result.command : "").toBe("clear-whitespace-and-newline-and-indent")
})

test("markdown-mode onEnter applies proportional default face remap", () => {
  const editor = makeEditor()
  install(editor)
  const buffer = new BufferModel({ name: "doc.md", text: "# Title", mode: "text" })
  enterMode(buffer, "markdown")
  expect(getBufferFaceRemap(buffer, "default")?.family).toBe("Helvetica Neue")
  expect(getBufferFaceRemap(buffer, "default")?.height).toBe(200)
})

describe("markdown-cycle", () => {
  test("TAB on heading folds subtree instead of indenting", async () => {
    const editor = makeEditor()
    install(editor)
    const buffer = editor.scratch("doc.md", DOC, "markdown")
    buffer.point = 0
    await editor.run("markdown-cycle")
    const folded = buffer.locals.get(MARKDOWN_FOLDED_LOCAL) as Array<[number, number]>
    expect(folded?.length).toBeGreaterThan(0)
    expect(buffer.text).toBe(DOC)
    expect(buffer.text.startsWith("    # Top")).toBe(false)
  })

  test("TAB on ATX heading does not indent the heading line", async () => {
    const editor = makeEditor()
    install(editor)
    const buffer = editor.scratch("doc.md", "# Title\n", "markdown")
    buffer.point = 0
    await keySeq(editor, "tab")
    expect(buffer.text).toBe("# Title\n")
  })
})

describe("markdownParseHeadings", () => {
  test("parses ATX and setext headings", () => {
    const text = "# One\n\nTitle\n---\n\n## Two\n"
    const hs = markdownParseHeadings(text)
    expect(hs.map(h => [h.level, h.title])).toEqual([
      [1, "One"],
      [2, "Title"],
      [2, "Two"],
    ])
  })
})

describe("markdownDisplayFilter", () => {
  test("collapses folded line ranges with ellipsis", () => {
    const buffer = new BufferModel({ name: "doc.md", text: DOC, mode: "markdown" })
    buffer.locals.set(MARKDOWN_FOLDED_LOCAL, [[1, 5]])
    const result = markdownDisplayFilter(buffer)
    expect(result?.text).toContain("# Top")
    expect(result?.text).toContain("...")
    expect(result?.text).not.toContain("deep")
  })
})

describe("clear-whitespace-and-newline-and-indent", () => {
  test("trims trailing whitespace on the line above after RET", async () => {
    const editor = makeEditor()
    install(editor)
    const buffer = editor.scratch("doc.md", "line with spaces   ", "markdown")
    buffer.point = buffer.text.length
    await editor.run("clear-whitespace-and-newline-and-indent")
    expect(buffer.text).toBe("line with spaces\n")
  })
})
