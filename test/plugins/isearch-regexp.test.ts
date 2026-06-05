import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install, isearchNoUpperCaseP } from "../../plugins/isearch-regexp"
import {
  findBackward,
  findForward,
  findRegexpBackward,
  findRegexpForward,
  isearchMatchSpan,
  isearchPrompt,
  setIsearchRegexp,
} from "../../src/kernel/isearch"

describe("isearchNoUpperCaseP", () => {
  test("literal: lowercase → fold, any uppercase → no fold", () => {
    expect(isearchNoUpperCaseP("hello", false)).toBe(true)
    expect(isearchNoUpperCaseP("Hello", false)).toBe(false)
    expect(isearchNoUpperCaseP("123 .+*", false)).toBe(true)
  })

  test("regexp: backslash-escaped letters are ignored", () => {
    expect(isearchNoUpperCaseP("\\W\\S\\B", true)).toBe(true)
    expect(isearchNoUpperCaseP("\\Wfoo", true)).toBe(true)
    expect(isearchNoUpperCaseP("\\WFoo", true)).toBe(false)
    expect(isearchNoUpperCaseP("\\\\W", true)).toBe(false)
  })

  test("regexp: [:upper:]/[:lower:] force case sensitivity", () => {
    expect(isearchNoUpperCaseP("[[:upper:]]+", true)).toBe(false)
    expect(isearchNoUpperCaseP("[[:lower:]]", true)).toBe(false)
    expect(isearchNoUpperCaseP("[[:alpha:]]", true)).toBe(true)
  })
})

describe("smart case-fold for literal isearch", () => {
  test("lowercase needle matches mixed-case text", () => {
    setIsearchRegexp(false)
    expect(findForward("Foo BAR foo", "foo", 0)).toBe(0)
    expect(findForward("Foo BAR foo", "bar", 0)).toBe(4)
    expect(findBackward("Foo BAR foo", "foo", 11)).toBe(8)
  })

  test("uppercase in needle forces exact case", () => {
    setIsearchRegexp(false)
    expect(findForward("foo Foo FOO", "Foo", 0)).toBe(4)
    expect(findForward("foo bar", "Foo", 0)).toBeNull()
  })

  test("isearchMatchSpan honours case-fold at point", () => {
    const editor = makeEditor()
    install(editor)
    const buf = editor.scratch("case", "Hello World", "text")
    buf.point = 0
    const span = isearchMatchSpan(buf, { bufferId: buf.id, string: "hello", direction: 1, startPoint: 0 })
    expect(span).toEqual({ start: 0, end: 5, face: "isearch" })
  })
})

describe("regexp helpers", () => {
  test("findRegexpForward/Backward locate variable-length matches", () => {
    const text = "a1 b22 c333"
    expect(findRegexpForward(text, "[0-9]+", 0, true)).toEqual({ start: 1, end: 2 })
    expect(findRegexpForward(text, "[0-9]+", 2, true)).toEqual({ start: 4, end: 6 })
    expect(findRegexpBackward(text, "[0-9]+", text.length, true)).toEqual({ start: 8, end: 11 })
    expect(findRegexpBackward(text, "[0-9]+", 4, true)).toEqual({ start: 1, end: 2 })
  })

  test("invalid pattern yields null, not throw", () => {
    expect(findRegexpForward("abc", "(", 0, true)).toBeNull()
  })
})

describe("isearch-forward-regexp / isearch-backward-regexp", () => {
  async function setup(text: string) {
    const editor = makeEditor()
    install(editor)
    const buf = editor.scratch("re", text, "text")
    buf.point = 0
    return { editor, buf }
  }

  async function type(editor: ReturnType<typeof makeEditor>, s: string) {
    for (const ch of s) await editor.handleKey({ name: ch, sequence: ch })
  }

  test("C-M-s and C-M-r are bound", () => {
    const editor = makeEditor()
    install(editor)
    expect(editor.keymap.get("C-M-s")).toBe("isearch-forward-regexp")
    expect(editor.keymap.get("C-M-r")).toBe("isearch-backward-regexp")
  })

  test("forward regexp search moves point to first match and repeats", async () => {
    const { editor, buf } = await setup("foo a1 b22 c333 done")
    await editor.run("isearch-forward-regexp")
    expect(editor.isearch?.regexp).toBe(true)
    await type(editor, "[0-9]+")
    expect(buf.point).toBe(5)
    await editor.run("isearch-forward-regexp")
    expect(buf.point).toBe(8)
    await editor.run("isearch-forward-regexp")
    expect(buf.point).toBe(12)
  })

  test("regexp match span covers the actual match length", async () => {
    const { editor, buf } = await setup("foo 12345 bar")
    await editor.run("isearch-forward-regexp")
    await type(editor, "[0-9]+")
    const span = isearchMatchSpan(buf, editor.isearch!)
    expect(span).toEqual({ start: 4, end: 9, face: "isearch" })
  })

  test("backward regexp search finds last match before point", async () => {
    const { editor, buf } = await setup("a1 b22 c333")
    buf.point = buf.text.length
    await editor.run("isearch-backward-regexp")
    await type(editor, "[a-z][0-9]+")
    expect(buf.point).toBe(7)
    await editor.run("isearch-backward-regexp")
    expect(buf.point).toBe(3)
  })

  test("regexp smart case: escaped \\w stays folded, bare capital does not", async () => {
    const { editor, buf } = await setup("two THREE four")
    await editor.run("isearch-forward-regexp")
    await type(editor, "t\\w+")
    expect(buf.point).toBe(0)
    editor.endIsearch()

    buf.point = 0
    await editor.run("isearch-forward-regexp")
    await type(editor, "T\\w+")
    expect(buf.point).toBe(4)
    editor.endIsearch()
  })

  test("prompt reflects regexp mode", async () => {
    const { editor } = await setup("abc")
    await editor.run("isearch-forward-regexp")
    expect(isearchPrompt(editor.isearch!)).toBe("Regexp I-search: ")
    editor.endIsearch()
    await editor.run("isearch-backward-regexp")
    expect(isearchPrompt(editor.isearch!)).toBe("Regexp I-search backward: ")
  })

  test("literal isearch after regexp resets mode", async () => {
    const { editor, buf } = await setup("axb a.b")
    await editor.run("isearch-forward-regexp")
    await type(editor, "a.b")
    expect(buf.point).toBe(0)
    editor.endIsearch()

    buf.point = 0
    await editor.run("isearch-forward")
    expect(editor.isearch?.regexp).toBe(false)
    await type(editor, "a.b")
    expect(buf.point).toBe(4)
  })
})
