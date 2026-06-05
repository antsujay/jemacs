import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install } from "../../plugins/electric-pair"
import type { Editor } from "../../src/kernel/editor"

async function type(editor: Editor, chars: string): Promise<void> {
  for (const ch of chars) {
    await editor.handleKey({ name: ch, sequence: ch })
  }
}

function setup(): Editor {
  const editor = makeEditor()
  install(editor)
  editor.currentBuffer.setText("", false)
  editor.currentBuffer.point = 0
  editor.enableMinorMode("electric-pair-mode")
  return editor
}

describe("electric-pair-mode", () => {
  test("registers as a global minor mode with a toggle command", async () => {
    const editor = makeEditor()
    install(editor)
    expect(editor.isMinorModeEnabled("electric-pair-mode")).toBe(false)
    await editor.run("electric-pair-mode")
    expect(editor.isMinorModeEnabled("electric-pair-mode")).toBe(true)
    expect(editor.globalMinorModes.has("electric-pair-mode")).toBe(true)
    await editor.run("electric-pair-mode")
    expect(editor.isMinorModeEnabled("electric-pair-mode")).toBe(false)
  })

  test("inserts closer after opener and leaves point between", async () => {
    const editor = setup()
    await type(editor, "(")
    expect(editor.currentBuffer.text).toBe("()")
    expect(editor.currentBuffer.point).toBe(1)
  })

  test("pairs all bracket types", async () => {
    const editor = setup()
    await type(editor, "([{")
    expect(editor.currentBuffer.text).toBe("([{}])")
    expect(editor.currentBuffer.point).toBe(3)
  })

  test("typing closer at existing closer skips past it", async () => {
    const editor = setup()
    await type(editor, "()")
    expect(editor.currentBuffer.text).toBe("()")
    expect(editor.currentBuffer.point).toBe(2)
  })

  test("typing closer with no match ahead just inserts it", async () => {
    const editor = setup()
    await type(editor, ")")
    expect(editor.currentBuffer.text).toBe(")")
    expect(editor.currentBuffer.point).toBe(1)
  })

  test("double-quote pairs and then skips", async () => {
    const editor = setup()
    await type(editor, '"')
    expect(editor.currentBuffer.text).toBe('""')
    expect(editor.currentBuffer.point).toBe(1)
    await type(editor, '"')
    expect(editor.currentBuffer.text).toBe('""')
    expect(editor.currentBuffer.point).toBe(2)
  })

  test("single-quote and backtick pair", async () => {
    const editor = setup()
    await type(editor, "'")
    expect(editor.currentBuffer.text).toBe("''")
    expect(editor.currentBuffer.point).toBe(1)

    editor.currentBuffer.setText("", false)
    editor.currentBuffer.point = 0
    await type(editor, "`")
    expect(editor.currentBuffer.text).toBe("``")
    expect(editor.currentBuffer.point).toBe(1)
  })

  test("typing inside a pair leaves the closer in place", async () => {
    const editor = setup()
    await type(editor, "(abc)")
    expect(editor.currentBuffer.text).toBe("(abc)")
    expect(editor.currentBuffer.point).toBe(5)
  })

  test("does nothing when the mode is disabled", async () => {
    const editor = makeEditor()
    install(editor)
    editor.currentBuffer.setText("", false)
    editor.currentBuffer.point = 0
    await type(editor, "(")
    expect(editor.currentBuffer.text).toBe("(")
    expect(editor.currentBuffer.point).toBe(1)
  })

  test("ordinary characters are unaffected", async () => {
    const editor = setup()
    await type(editor, "abc")
    expect(editor.currentBuffer.text).toBe("abc")
    expect(editor.currentBuffer.point).toBe(3)
  })

  describe("conservative inhibit", () => {
    test("opener before a word char does not pair", async () => {
      const editor = setup()
      editor.currentBuffer.setText("function add()", false)
      editor.currentBuffer.point = 0
      await type(editor, "(")
      expect(editor.currentBuffer.text).toBe("(function add()")
      expect(editor.currentBuffer.point).toBe(1)
    })

    test("opener before non-word char still pairs", async () => {
      const editor = setup()
      editor.currentBuffer.setText(" + 1", false)
      editor.currentBuffer.point = 0
      await type(editor, "(")
      expect(editor.currentBuffer.text).toBe("() + 1")
    })

    test("quote after a word char does not pair (apostrophe)", async () => {
      const editor = setup()
      editor.currentBuffer.setText("don", false)
      editor.currentBuffer.point = 3
      await type(editor, "'")
      expect(editor.currentBuffer.text).toBe("don'")
      await type(editor, "t")
      expect(editor.currentBuffer.text).toBe("don't")
    })

    test("quote before a word char does not pair", async () => {
      const editor = setup()
      editor.currentBuffer.setText("foo", false)
      editor.currentBuffer.point = 0
      await type(editor, '"')
      expect(editor.currentBuffer.text).toBe('"foo')
    })

    test("brackets after a word char still pair (only quotes check before)", async () => {
      const editor = setup()
      editor.currentBuffer.setText("fn", false)
      editor.currentBuffer.point = 2
      await type(editor, "(")
      expect(editor.currentBuffer.text).toBe("fn()")
      expect(editor.currentBuffer.point).toBe(3)
    })
  })
})
