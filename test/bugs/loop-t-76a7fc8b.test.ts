import { describe, expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import { keySeq } from "../harness/script"
import { Editor, type CompletingReadFunction } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"

// t-76a7fc8b merged batch — editor.ts dispatch/isearch/minibuffer hardening.
// Implementation landed in be88a61 + c3826d9; this file pins the behaviours.

describe("t-76a7fc8b [erro-2]: throwing fallthrough command still ends isearch", () => {
  test("non-isearch key during isearch clears state even if the command throws", async () => {
    const editor = makeEditor()
    editor.command("boom", () => { throw new Error("kaboom") })
    editor.defineKey("global-map", "C-t", "boom")
    const buf = editor.currentBuffer
    buf.setText("abc target abc", false)
    buf.point = 0

    await keySeq(editor, "C-s", "t", "a", "r")
    expect(editor.isearch?.string).toBe("tar")
    expect(buf.point).toBe(4)

    // Fallthrough to a non-isearch command that throws: handleKey rejects,
    // but the try/finally in dispatchKey must end the search regardless.
    await expect(editor.handleKey({ name: "t", ctrl: true })).rejects.toThrow("kaboom")
    expect(editor.isearch).toBeNull()

    // Next printable key self-inserts at point — it must NOT silently append
    // to a phantom search string.
    await keySeq(editor, "X")
    expect(buf.text).toContain("X")
    expect(editor.isearch).toBeNull()
  })

  test("isearch-* commands and keyboard-quit are not double-ended", async () => {
    const editor = makeEditor()
    editor.currentBuffer.setText("foo bar foo", false)
    editor.currentBuffer.point = 0
    await keySeq(editor, "C-s", "f", "o", "o")
    // C-s again is isearch-forward → repeat; must NOT exit.
    await keySeq(editor, "C-s")
    expect(editor.isearch).not.toBeNull()
    expect(editor.currentBuffer.point).toBe(8)
    // C-g cancels (restores startPoint) — endIsearch must not also fire.
    await keySeq(editor, "C-g")
    expect(editor.isearch).toBeNull()
    expect(editor.currentBuffer.point).toBe(0)
  })
})

describe("t-d6764d7a [erro-6]: prompt() executor throw does not leak depth/buffer", () => {
  test("addBuffer throwing inside prompt() restores minibufferDepth and previous request", async () => {
    const editor = makeEditor()
    expect(editor.minibufferDepthLevel).toBe(0)
    const orig = editor.addBuffer.bind(editor)
    let armed = true
    editor.addBuffer = (b: BufferModel) => {
      if (armed && b.kind === "minibuffer") { armed = false; throw new Error("addBuffer boom") }
      return orig(b)
    }
    await expect(editor.prompt("Broken: ")).rejects.toThrow("addBuffer boom")
    expect(editor.minibufferDepthLevel).toBe(0)
    expect(editor.minibuffer).toBeNull()
    const leaked = [...editor.buffers.values()].some(b => b.name.includes("*Minibuffer-"))
    expect(leaked).toBe(false)
  })
})

describe("t-6d222ddb [step-6]: completingReadFunction stack tolerates out-of-order pop", () => {
  test("enable A → enable B → disable A → disable B leaves no resurrected function", () => {
    const editor = new Editor()
    const a: CompletingReadFunction = async () => "a"
    const b: CompletingReadFunction = async () => "b"
    editor.pushCompletingReadFunction(a)
    editor.pushCompletingReadFunction(b)
    expect(editor.completingReadFunction).toBe(b)
    editor.popCompletingReadFunction(a) // out-of-order
    expect(editor.completingReadFunction).toBe(b)
    editor.popCompletingReadFunction(b)
    expect(editor.completingReadFunction).toBeNull()
  })
})

describe("t-87311a94 [Feat-1] / t-92e15670 [Feat-2]: isearch C-w and search-ring", () => {
  test("C-w yanks word-or-char from buffer into the search string", async () => {
    const editor = makeEditor()
    const buf = editor.currentBuffer
    buf.setText("hello world again", false)
    buf.point = 0
    await keySeq(editor, "C-s")
    await editor.handleKey({ name: "w", ctrl: true })
    expect(editor.isearch?.string).toBe("hello")
    await editor.handleKey({ name: "w", ctrl: true })
    expect(editor.isearch?.string).toBe("hello world")
  })

  test("C-s C-s with empty string recalls last search from the ring", async () => {
    const editor = makeEditor()
    const buf = editor.currentBuffer
    buf.setText("alpha beta alpha", false)
    buf.point = 0
    await keySeq(editor, "C-s", "a", "l", "p", "h", "a", "RET")
    expect(editor.isearch).toBeNull()
    buf.point = 0
    await keySeq(editor, "C-s") // empty string
    expect(editor.isearch?.string).toBe("")
    await keySeq(editor, "C-s") // repeat → recall ring
    expect(editor.isearch?.string).toBe("alpha")
    expect(buf.point).toBe(0)
  })
})
