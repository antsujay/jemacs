import { expect, test } from "bun:test"
import { install } from "../../plugins/window"
import { installDefaultConfig } from "../../src/config"
import { Editor } from "../../src/kernel/editor"
import { listWindowLeaves } from "../../src/kernel/window"

function setup(): Editor {
  const editor = new Editor()
  installDefaultConfig(editor)
  install(editor)
  return editor
}

function expectRatioClose(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined()
  expect(Math.abs((actual ?? 0) - expected)).toBeLessThan(0.001)
}

test("window plugin binds GNU balance-windows key and split aliases", async () => {
  const editor = setup()

  expect(editor.keymap.get("C-x +")).toBe("balance-windows")
  expect(editor.commands.get("balance-windows")).toBeDefined()
  expect(editor.commands.get("split-window")).toBeDefined()
  expect(editor.commands.get("split-window-horizontally")).toBeDefined()
  expect(editor.commands.get("split-window-vertically")).toBeDefined()

  await editor.run("split-window-horizontally")
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind === "split") expect(editor.windowLayout.direction).toBe("horizontal")
})

test("default config includes the core window plugin", () => {
  const editor = new Editor()
  installDefaultConfig(editor)

  expect(editor.keymap.get("C-x +")).toBe("balance-windows")
  expect(editor.commands.get("balance-windows")).toBeDefined()
})

test("balance-windows assigns split ratios by visible leaf count", async () => {
  const editor = setup()

  await editor.run("split-window-below")
  await editor.run("other-window")
  await editor.run("split-window-right")
  await editor.run("balance-windows")

  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(3)
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind !== "split") return
  expectRatioClose(editor.windowLayout.firstRatio, 1 / 3)
  expect(editor.windowLayout.second.kind).toBe("split")
  if (editor.windowLayout.second.kind !== "split") return
  expectRatioClose(editor.windowLayout.second.firstRatio, 1 / 2)
})

test("window plugin auto-balances after split and delete commands", async () => {
  const editor = setup()

  await editor.run("split-window-below")
  await editor.run("other-window")
  await editor.run("split-window-right")
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind !== "split") return
  expectRatioClose(editor.windowLayout.firstRatio, 1 / 3)

  await editor.run("delete-window")
  expect(listWindowLeaves(editor.windowLayout)).toHaveLength(2)
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind === "split") expectRatioClose(editor.windowLayout.firstRatio, 1 / 2)
})

test("other-window preserves balanced split ratios", async () => {
  const editor = setup()

  await editor.run("split-window-below")
  await editor.run("other-window")
  await editor.run("split-window-right")
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind !== "split") return
  expectRatioClose(editor.windowLayout.firstRatio, 1 / 3)

  await editor.run("other-window")
  expect(editor.windowLayout.kind).toBe("split")
  if (editor.windowLayout.kind === "split") expectRatioClose(editor.windowLayout.firstRatio, 1 / 3)
})
