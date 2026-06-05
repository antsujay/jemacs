import { expect, test } from "bun:test"
import { makeEditor } from "./helper"
import { install, localMarkRing, globalMarkRing } from "../../plugins/mark-ring"

function setup() {
  const editor = makeEditor()
  install(editor)
  return editor
}

test("set-mark-command pushes old mark onto the local ring", async () => {
  const editor = setup()
  const buf = editor.scratch("a", "hello world")
  buf.point = 0
  await editor.run("set-mark-command")
  expect(buf.mark).toBe(0)
  expect(localMarkRing(buf)).toEqual([])

  buf.point = 5
  await editor.run("set-mark-command")
  expect(buf.mark).toBe(5)
  expect(localMarkRing(buf)).toEqual([0])

  buf.point = 10
  await editor.run("set-mark-command")
  expect(buf.mark).toBe(10)
  expect(localMarkRing(buf)).toEqual([5, 0])
})

test("C-u set-mark-command jumps to mark and rotates the local ring", async () => {
  const editor = setup()
  const buf = editor.scratch("a", "0123456789")
  for (const p of [1, 3, 7]) {
    buf.point = p
    await editor.run("set-mark-command")
  }
  expect(buf.mark).toBe(7)
  expect(localMarkRing(buf)).toEqual([3, 1])

  buf.point = 9
  editor.prefixArg.universalArgument()
  await editor.run("set-mark-command")
  expect(buf.point).toBe(7)
  expect(buf.mark).toBe(3)
  expect(localMarkRing(buf)).toEqual([1, 7])

  editor.prefixArg.universalArgument()
  await editor.run("set-mark-command")
  expect(buf.point).toBe(3)
  expect(buf.mark).toBe(1)
  expect(localMarkRing(buf)).toEqual([7, 3])
})

test("C-u set-mark-command with no mark reports an error", async () => {
  const editor = setup()
  const buf = editor.scratch("a", "abc")
  let lastMessage = ""
  editor.events.on("message", ({ text }) => { lastMessage = text })
  editor.prefixArg.universalArgument()
  await editor.run("set-mark-command")
  expect(lastMessage).toBe("No mark set in this buffer")
  expect(buf.point).toBe(0)
})

test("local mark ring is capped at 16 entries", async () => {
  const editor = setup()
  const buf = editor.scratch("a", "x".repeat(100))
  for (let i = 0; i < 20; i++) {
    buf.point = i
    await editor.run("set-mark-command")
  }
  const ring = localMarkRing(buf)
  expect(ring.length).toBe(16)
  expect(ring[0]).toBe(18)
  expect(ring[15]).toBe(3)
})

test("global ring records buffer changes and pop-global-mark cycles through them", async () => {
  const editor = setup()
  const a = editor.scratch("a", "aaaaaa")
  a.point = 2
  await editor.run("set-mark-command")
  a.point = 4
  await editor.run("set-mark-command")

  const b = editor.scratch("b", "bbbbbb")
  b.point = 1
  await editor.run("set-mark-command")

  const global = globalMarkRing(editor)
  expect(global.map(m => m.bufferId)).toEqual([b.id, a.id])

  await editor.run("pop-global-mark")
  expect(editor.currentBuffer.id).toBe(b.id)
  expect(editor.currentBuffer.point).toBe(1)

  await editor.run("pop-global-mark")
  expect(editor.currentBuffer.id).toBe(a.id)
  expect(editor.currentBuffer.point).toBe(2)

  await editor.run("pop-global-mark")
  expect(editor.currentBuffer.id).toBe(b.id)
})

test("pop-global-mark skips killed buffers", async () => {
  const editor = setup()
  const a = editor.scratch("a", "aaa")
  a.point = 1
  await editor.run("set-mark-command")
  const b = editor.scratch("b", "bbb")
  b.point = 2
  await editor.run("set-mark-command")
  editor.scratch("c", "ccc")

  editor.killBuffer(b.id)
  await editor.run("pop-global-mark")
  expect(editor.currentBuffer.id).toBe(a.id)
  expect(editor.currentBuffer.point).toBe(1)
})

test("C-x C-space is bound to pop-global-mark", () => {
  const editor = setup()
  expect(editor.keymap.get("C-x C-space")).toBe("pop-global-mark")
  expect(editor.keymap.get("C-x C-@")).toBe("pop-global-mark")
})
