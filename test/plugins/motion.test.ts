import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install } from "../../plugins/motion"

function setup(text: string, point: number) {
  const editor = makeEditor()
  install(editor)
  const buffer = editor.currentBuffer
  buffer.setText(text, false)
  buffer.point = point
  return { editor, buffer }
}

describe("keybindings", () => {
  test("motion commands are bound", () => {
    const editor = makeEditor()
    install(editor)
    expect(editor.keymap.get("M-m")).toBe("back-to-indentation")
    expect(editor.keymap.get("M-}")).toBe("forward-paragraph")
    expect(editor.keymap.get("M-{")).toBe("backward-paragraph")
    expect(editor.keymap.get("M-h")).toBe("mark-paragraph")
    expect(editor.keymap.get("M-t")).toBe("transpose-words")
    expect(editor.keymap.get("C-x C-t")).toBe("transpose-lines")
  })
})

describe("back-to-indentation", () => {
  test("moves to first non-whitespace on line", async () => {
    const { editor, buffer } = setup("    hello world\n", 12)
    await editor.run("back-to-indentation")
    expect(buffer.point).toBe(4)
  })

  test("from before indentation moves forward to text", async () => {
    const { editor, buffer } = setup("\t  foo\n", 0)
    await editor.run("back-to-indentation")
    expect(buffer.point).toBe(3)
  })

  test("on a blank line moves to end of whitespace", async () => {
    const { editor, buffer } = setup("abc\n   \ndef\n", 5)
    await editor.run("back-to-indentation")
    expect(buffer.point).toBe(7)
  })

  test("on a line with no indentation stays at column 0", async () => {
    const { editor, buffer } = setup("one\ntwo\n", 6)
    await editor.run("back-to-indentation")
    expect(buffer.point).toBe(4)
  })
})

describe("forward-paragraph / backward-paragraph", () => {
  const text = "aaa\n\nbbb\n\nccc"

  test("forward-paragraph stops at blank line after paragraph", async () => {
    const { editor, buffer } = setup(text, 0)
    await editor.run("forward-paragraph")
    expect(buffer.point).toBe(4)
    await editor.run("forward-paragraph")
    expect(buffer.point).toBe(9)
    await editor.run("forward-paragraph")
    expect(buffer.point).toBe(13)
  })

  test("forward-paragraph from blank line skips to next boundary", async () => {
    const { editor, buffer } = setup(text, 4)
    await editor.run("forward-paragraph")
    expect(buffer.point).toBe(9)
  })

  test("backward-paragraph stops at blank line before paragraph", async () => {
    const { editor, buffer } = setup(text, 12)
    await editor.run("backward-paragraph")
    expect(buffer.point).toBe(9)
    await editor.run("backward-paragraph")
    expect(buffer.point).toBe(4)
    await editor.run("backward-paragraph")
    expect(buffer.point).toBe(0)
  })

  test("backward-paragraph from inside first paragraph goes to bob", async () => {
    const { editor, buffer } = setup(text, 2)
    await editor.run("backward-paragraph")
    expect(buffer.point).toBe(0)
  })

  test("whitespace-only lines separate paragraphs", async () => {
    const { editor, buffer } = setup("one\ntwo\n  \nthree\n", 0)
    await editor.run("forward-paragraph")
    expect(buffer.point).toBe(8)
  })

  test("prefix argument repeats motion", async () => {
    const { editor, buffer } = setup(text, 0)
    editor.prefixArg.addDigit(2)
    await editor.run("forward-paragraph")
    expect(buffer.point).toBe(9)
  })

  test("mark-paragraph marks the containing paragraph", async () => {
    const { editor, buffer } = setup(text, 6)
    await editor.run("mark-paragraph")
    expect(buffer.point).toBe(4)
    expect(buffer.mark).toBe(9)
    expect(buffer.markActive).toBe(true)
    expect(buffer.selectedText()).toBe("\nbbb\n")
  })

  test("mark-paragraph with negative prefix puts point at end and mark at beginning", async () => {
    const { editor, buffer } = setup(text, 6)
    editor.prefixArg.toggleNegative()
    await editor.run("mark-paragraph")
    expect(buffer.point).toBe(9)
    expect(buffer.mark).toBe(4)
    expect(buffer.markActive).toBe(true)
    expect(buffer.selectedText()).toBe("\nbbb\n")
  })
})

describe("transpose-words", () => {
  test("swaps word before point with word after point", async () => {
    const { editor, buffer } = setup("foo bar", 4)
    await editor.run("transpose-words")
    expect(buffer.text).toBe("bar foo")
    expect(buffer.point).toBe(7)
  })

  test("from inside a word drags it past the next", async () => {
    const { editor, buffer } = setup("alpha beta gamma", 2)
    await editor.run("transpose-words")
    expect(buffer.text).toBe("beta alpha gamma")
    expect(buffer.point).toBe(10)
  })

  test("preserves separator between words", async () => {
    const { editor, buffer } = setup("hello, world", 6)
    await editor.run("transpose-words")
    expect(buffer.text).toBe("world, hello")
    expect(buffer.point).toBe(12)
  })

  test("with one word does nothing", async () => {
    const { editor, buffer } = setup("solo", 2)
    await editor.run("transpose-words")
    expect(buffer.text).toBe("solo")
  })
})

describe("transpose-lines", () => {
  test("swaps current line with previous, point lands after both", async () => {
    const { editor, buffer } = setup("aaa\nbbb\nccc\n", 5)
    await editor.run("transpose-lines")
    expect(buffer.text).toBe("bbb\naaa\nccc\n")
    expect(buffer.point).toBe(8)
  })

  test("on last line without trailing newline appends one", async () => {
    const { editor, buffer } = setup("one\ntwo", 5)
    await editor.run("transpose-lines")
    expect(buffer.text).toBe("two\none\n")
    expect(buffer.point).toBe(8)
  })

  test("on first line is a no-op", async () => {
    const { editor, buffer } = setup("aaa\nbbb\n", 1)
    await editor.run("transpose-lines")
    expect(buffer.text).toBe("aaa\nbbb\n")
  })

  test("lines of different length keep separator placement", async () => {
    const { editor, buffer } = setup("x\nlonger\nz\n", 3)
    await editor.run("transpose-lines")
    expect(buffer.text).toBe("longer\nx\nz\n")
    expect(buffer.point).toBe(9)
  })
})
