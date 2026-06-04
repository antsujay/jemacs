import { expect, test } from "bun:test"
import { Editor } from "../src/kernel/editor"
import { installDefaultCommands } from "../src/init/default-commands"
import {
  createLeafWindow,
  listWindowLeaves,
  splitWindowLeaf,
  type WindowNode,
} from "../src/kernel/window"

function installEditor(): Editor {
  const editor = new Editor()
  installDefaultCommands(editor)
  return editor
}

test("split-window-below stacks vertically and selects the new window", async () => {
  const editor = installEditor()
  await editor.run("split-window-below")
  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(2)
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind === "split") {
    expect(editor.windowLayout.direction).toBe("vertical")
  }
  expect(editor.selectedWindow).toBe(1)
})

test("split-window-right places panes side by side", async () => {
  const editor = installEditor()
  await editor.run("split-window-right")
  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(2)
  if (editor.windowLayout.kind === "split") {
    expect(editor.windowLayout.direction).toBe("horizontal")
  }
})

test("other-window cycles through leaves in tree order", async () => {
  const editor = installEditor()
  await editor.run("split-window-below")
  expect(editor.selectedWindow).toBe(1)
  await editor.run("other-window")
  expect(editor.selectedWindow).toBe(0)
})

test("delete-other-windows keeps only the selected pane", async () => {
  const editor = installEditor()
  await editor.run("split-window-below")
  await editor.run("other-window")
  await editor.run("delete-other-windows")
  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(1)
  expect(editor.windowLayout.kind).toBe("leaf")
})

test("delete-window removes the selected pane", async () => {
  const editor = installEditor()
  await editor.run("split-window-right")
  await editor.run("delete-window")
  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(1)
})

test("split windows preserve independent points into the same buffer", async () => {
  const editor = installEditor()
  const buffer = editor.currentBuffer
  buffer.setText("alpha\nbeta\ngamma", false)
  buffer.point = 0
  await editor.run("split-window-below")
  buffer.point = 11
  await editor.run("other-window")
  expect(buffer.point).toBe(0)
  await editor.run("other-window")
  expect(buffer.point).toBe(11)
})

test("splitWindowLeaf builds nested layouts", () => {
  const root = createLeafWindow("a", 0)
  const below = splitWindowLeaf(root, root.id, "vertical", "a", 0)
  const right = splitWindowLeaf(below.layout, below.newWindowId, "horizontal", "a", 0)
  const leaves = listWindowLeaves(right.layout)
  expect(leaves).toHaveLength(3)
  expect(countDirections(right.layout, "vertical")).toBe(1)
  expect(countDirections(right.layout, "horizontal")).toBe(1)
})

function countDirections(node: WindowNode, direction: "horizontal" | "vertical"): number {
  if (node.kind === "leaf") return 0
  return (node.direction === direction ? 1 : 0)
    + countDirections(node.first, direction)
    + countDirections(node.second, direction)
}
