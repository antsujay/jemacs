import { expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install, windowInDirection } from "../../plugins/windmove"
import { listWindowLeaves } from "../../src/kernel/window"
import { setCustom } from "../../src/runtime/custom"

function leafId(editor: ReturnType<typeof makeEditor>, index: number): string {
  return listWindowLeaves(editor.windowLayout)[index]!.id
}

test("windmove registers commands and S-<arrow> bindings", () => {
  const editor = makeEditor()
  install(editor)
  expect(editor.commands.get("windmove-left")).toBeDefined()
  expect(editor.commands.get("windmove-right")).toBeDefined()
  expect(editor.commands.get("windmove-up")).toBeDefined()
  expect(editor.commands.get("windmove-down")).toBeDefined()
  expect(editor.keymap.get("S-left")).toBe("windmove-left")
  expect(editor.keymap.get("S-right")).toBe("windmove-right")
  expect(editor.keymap.get("S-up")).toBe("windmove-up")
  expect(editor.keymap.get("S-down")).toBe("windmove-down")
})

test("windmove with a single window reports no neighbor and stays put", async () => {
  const editor = makeEditor()
  install(editor)
  const only = editor.selectedWindowId
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  await editor.run("windmove-right")
  expect(editor.selectedWindowId).toBe(only)
  expect(lastMessage).toBe("No window right from selected window")
})

test("windmove-left/right across a horizontal split", async () => {
  const editor = makeEditor()
  install(editor)
  editor.splitWindowRight()
  const left = leafId(editor, 0)
  const right = leafId(editor, 1)
  expect(editor.selectedWindowId).toBe(right)

  await editor.run("windmove-left")
  expect(editor.selectedWindowId).toBe(left)
  await editor.run("windmove-right")
  expect(editor.selectedWindowId).toBe(right)

  await editor.run("windmove-up")
  expect(editor.selectedWindowId).toBe(right)
  await editor.run("windmove-down")
  expect(editor.selectedWindowId).toBe(right)
})

test("windmove-up/down across a vertical split", async () => {
  const editor = makeEditor()
  install(editor)
  editor.splitWindowBelow()
  const top = leafId(editor, 0)
  const bottom = leafId(editor, 1)
  expect(editor.selectedWindowId).toBe(bottom)

  await editor.run("windmove-up")
  expect(editor.selectedWindowId).toBe(top)
  await editor.run("windmove-down")
  expect(editor.selectedWindowId).toBe(bottom)

  await editor.run("windmove-left")
  expect(editor.selectedWindowId).toBe(bottom)
})

test("windmove walks the tree geometrically in a 3-pane L-shaped layout", async () => {
  // +-----+-----+
  // |     |  A  |
  // |  L  +-----+
  // |     |  B  |
  // +-----+-----+
  const editor = makeEditor()
  install(editor)
  editor.splitWindowRight()
  editor.splitWindowBelow()
  const [l, a, b] = listWindowLeaves(editor.windowLayout).map(w => w.id) as [string, string, string]

  editor.selectWindow(a)
  await editor.run("windmove-down")
  expect(editor.selectedWindowId).toBe(b)
  await editor.run("windmove-up")
  expect(editor.selectedWindowId).toBe(a)
  await editor.run("windmove-left")
  expect(editor.selectedWindowId).toBe(l)

  editor.selectWindow(b)
  await editor.run("windmove-left")
  expect(editor.selectedWindowId).toBe(l)

  await editor.run("windmove-right")
  expect([a, b]).toContain(editor.selectedWindowId)

  editor.selectWindow(a)
  await editor.run("windmove-right")
  expect(editor.selectedWindowId).toBe(a)
})

test("windowInDirection picks the nearer neighbor, not tree order", async () => {
  // +-----+-----+
  // |  T  |     |
  // +-----+  R  |
  // |  B  |     |
  // +-----+-----+
  const editor = makeEditor()
  install(editor)
  editor.splitWindowRight()
  const right = editor.selectedWindowId
  editor.selectWindow(leafId(editor, 0))
  editor.splitWindowBelow()
  const [t, b, r] = listWindowLeaves(editor.windowLayout).map(w => w.id) as [string, string, string]
  expect(r).toBe(right)

  expect(windowInDirection(editor.windowLayout, t, "right")).toBe(r)
  expect(windowInDirection(editor.windowLayout, b, "right")).toBe(r)
  expect(windowInDirection(editor.windowLayout, t, "down")).toBe(b)
  expect(windowInDirection(editor.windowLayout, b, "up")).toBe(t)
  expect(windowInDirection(editor.windowLayout, r, "left")).toBe(t)
  expect(windowInDirection(editor.windowLayout, r, "up")).toBeNull()
})

test("windmove-wrap-around wraps off the frame edge", async () => {
  const editor = makeEditor()
  install(editor)
  editor.splitWindowRight()
  const left = leafId(editor, 0)
  const right = leafId(editor, 1)

  editor.selectWindow(right)
  await editor.run("windmove-right")
  expect(editor.selectedWindowId).toBe(right)

  setCustom("windmove-wrap-around", true)
  await editor.run("windmove-right")
  expect(editor.selectedWindowId).toBe(left)
  editor.selectWindow(left)
  await editor.run("windmove-left")
  expect(editor.selectedWindowId).toBe(right)
  setCustom("windmove-wrap-around", false)
})
