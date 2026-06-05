import { describe, expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install } from "../../plugins/subword"

function setup(text: string, point = 0) {
  const editor = makeEditor()
  install(editor)
  const buffer = editor.scratch("*subword-test*", text, "text")
  buffer.point = point
  return { editor, buffer }
}

describe("subword-mode", () => {
  test("default forward-word treats CamelCase as one word", async () => {
    const { editor, buffer } = setup("GtkWindow rest")
    await editor.run("forward-word")
    expect(buffer.point).toBe(9)
  })

  test("forward-word stops at CamelCase boundaries when enabled", async () => {
    const { editor, buffer } = setup("GtkWindow rest")
    await editor.run("subword-mode")
    expect(editor.isMinorModeEnabled("subword-mode", buffer)).toBe(true)
    await editor.run("forward-word")
    expect(buffer.point).toBe(3)
    await editor.run("forward-word")
    expect(buffer.point).toBe(9)
    await editor.run("forward-word")
    expect(buffer.point).toBe(14)
  })

  test("forward-word handles all-caps prefix (NSGraphicsContext)", async () => {
    const { editor, buffer } = setup("NSGraphicsContext")
    await editor.run("subword-mode")
    await editor.run("forward-word")
    expect(buffer.point).toBe(2)
    await editor.run("forward-word")
    expect(buffer.point).toBe(10)
    await editor.run("forward-word")
    expect(buffer.point).toBe(17)
  })

  test("forward-word splits snake_case", async () => {
    const { editor, buffer } = setup("snake_case_name")
    await editor.run("subword-mode")
    await editor.run("forward-word")
    expect(buffer.point).toBe(5)
    await editor.run("forward-word")
    expect(buffer.point).toBe(10)
    await editor.run("forward-word")
    expect(buffer.point).toBe(15)
  })

  test("backward-word stops at CamelCase boundaries", async () => {
    const { editor, buffer } = setup("EmacsFrameClass", 15)
    await editor.run("subword-mode")
    await editor.run("backward-word")
    expect(buffer.point).toBe(10)
    await editor.run("backward-word")
    expect(buffer.point).toBe(5)
    await editor.run("backward-word")
    expect(buffer.point).toBe(0)
  })

  test("backward-word splits snake_case", async () => {
    const { editor, buffer } = setup("snake_case", 10)
    await editor.run("subword-mode")
    await editor.run("backward-word")
    expect(buffer.point).toBe(6)
    await editor.run("backward-word")
    expect(buffer.point).toBe(0)
  })

  test("disabling restores default word motion", async () => {
    const { editor, buffer } = setup("GtkWindow")
    await editor.run("subword-mode")
    await editor.run("subword-mode")
    expect(editor.isMinorModeEnabled("subword-mode", buffer)).toBe(false)
    await editor.run("forward-word")
    expect(buffer.point).toBe(9)
  })

  test("mode is buffer-local", async () => {
    const editor = makeEditor()
    install(editor)
    const a = editor.scratch("*a*", "GtkWindow", "text")
    a.point = 0
    await editor.run("subword-mode")
    const b = editor.scratch("*b*", "GtkWindow", "text")
    b.point = 0
    await editor.run("forward-word")
    expect(b.point).toBe(9)
    editor.switchToBuffer(a.id)
    a.point = 0
    await editor.run("forward-word")
    expect(a.point).toBe(3)
  })

  test("kill-word respects subword boundaries", async () => {
    const { editor, buffer } = setup("GtkWindow")
    await editor.run("subword-mode")
    await editor.run("kill-word")
    expect(buffer.text).toBe("Window")
  })

  test("subword-forward command works without enabling the mode", async () => {
    const { editor, buffer } = setup("GtkWindow")
    await editor.run("subword-forward")
    expect(buffer.point).toBe(3)
    expect(buffer.locals.has("word-forward-regexp")).toBe(false)
  })

  test("lighter shows in mode line", async () => {
    const { editor, buffer } = setup("x")
    await editor.run("subword-mode")
    expect(editor.minorModeLighters(buffer)).toContain(",")
  })
})
