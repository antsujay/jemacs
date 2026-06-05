import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install } from "../../plugins/comment-dwim"
import { setCustom } from "../../src/runtime/custom"

function setup(text: string, mode = "javascript") {
  const editor = makeEditor()
  install(editor)
  const buffer = editor.scratch("*test*", text, mode)
  return { editor, buffer }
}

describe("comment-dwim (M-;)", () => {
  test("binds keys", () => {
    const editor = makeEditor()
    install(editor)
    expect(editor.keymap.get("M-;")).toBe("comment-dwim")
    expect(editor.keymap.get("C-x C-;")).toBe("comment-line")
    expect(editor.keymap.get("C-c ;")).toBe("comment-line")
  })

  test("active region: comments uncommented lines", async () => {
    const { editor, buffer } = setup("let a = 1\nlet b = 2\nlet c = 3\n")
    buffer.point = 0
    buffer.setMark()
    buffer.point = 19
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("// let a = 1\n// let b = 2\nlet c = 3\n")
  })

  test("active region: uncomments when every line is already commented", async () => {
    const { editor, buffer } = setup("// let a = 1\n// let b = 2\n")
    buffer.point = 0
    buffer.setMark()
    buffer.point = buffer.text.length
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("let a = 1\nlet b = 2\n")
  })

  test("active region: mixed lines get commented, not uncommented", async () => {
    const { editor, buffer } = setup("// done\ntodo\n")
    buffer.point = 0
    buffer.setMark()
    buffer.point = buffer.text.length
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("// // done\n// todo\n")
  })

  test("region toggle preserves indentation", async () => {
    const { editor, buffer } = setup("  foo()\n    bar()\n", "python")
    buffer.point = 0
    buffer.setMark()
    buffer.point = buffer.text.length
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("  # foo()\n    # bar()\n")
    buffer.point = 0
    buffer.setMark()
    buffer.point = buffer.text.length
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("  foo()\n    bar()\n")
  })

  test("region toggle skips blank lines when commenting", async () => {
    const { editor, buffer } = setup("a\n\nb\n")
    buffer.point = 0
    buffer.setMark()
    buffer.point = buffer.text.length
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("// a\n\n// b\n")
  })

  test("region ending at column 0 excludes that line", async () => {
    const { editor, buffer } = setup("one\ntwo\nthree\n")
    buffer.point = 0
    buffer.setMark()
    buffer.point = 4
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("// one\ntwo\nthree\n")
  })

  test("no region, non-empty line: inserts EOL comment at comment-column", async () => {
    setCustom("comment-column", 32)
    const { editor, buffer } = setup("let x = 1\n")
    buffer.point = 3
    await editor.run("comment-dwim")
    const line = buffer.text.split("\n")[0]!
    expect(line.startsWith("let x = 1")).toBe(true)
    expect(line.indexOf("//")).toBe(32)
    expect(buffer.point).toBe(line.length)
  })

  test("no region, non-empty line: jumps to existing EOL comment", async () => {
    const { editor, buffer } = setup("let x = 1  // note\n")
    buffer.point = 0
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("let x = 1  // note\n")
    expect(buffer.point).toBe(14)
  })

  test("no region, empty line: inserts comment starter", async () => {
    const { editor, buffer } = setup("\n")
    buffer.point = 0
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("// \n")
    expect(buffer.point).toBe(3)
  })

  test("uses mode commentStart (python)", async () => {
    const { editor, buffer } = setup("x = 1\n", "python")
    buffer.point = 0
    buffer.setMark()
    buffer.point = 5
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("# x = 1\n")
  })

  test("messages when mode has no comment syntax", async () => {
    const { editor, buffer } = setup("hello\n", "text")
    let msg = ""
    editor.events.on("message", e => { msg = e.text })
    buffer.point = 0
    await editor.run("comment-dwim")
    expect(buffer.text).toBe("hello\n")
    expect(msg).toContain("No comment syntax")
  })
})

describe("comment-line (C-x C-;)", () => {
  test("toggles current line and moves to next", async () => {
    const { editor, buffer } = setup("alpha\nbeta\n")
    buffer.point = 2
    await editor.run("comment-line")
    expect(buffer.text).toBe("// alpha\nbeta\n")
    expect(buffer.point).toBe(9)
  })

  test("second invocation uncomments", async () => {
    const { editor, buffer } = setup("// alpha\nbeta\n")
    buffer.point = 0
    await editor.run("comment-line")
    expect(buffer.text).toBe("alpha\nbeta\n")
  })

  test("with active region toggles whole lines", async () => {
    const { editor, buffer } = setup("one\ntwo\nthree\n")
    buffer.point = 1
    buffer.setMark()
    buffer.point = 6
    await editor.run("comment-line")
    expect(buffer.text).toBe("// one\n// two\nthree\n")
  })

  test("prefix argument comments N lines", async () => {
    const { editor, buffer } = setup("a\nb\nc\nd\n")
    buffer.point = 0
    editor.prefixArg.addDigit(3)
    await editor.run("comment-line")
    expect(buffer.text).toBe("// a\n// b\n// c\nd\n")
  })
})
