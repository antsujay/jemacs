import type { Editor } from "../kernel/editor"
import { BufferModel } from "../kernel/buffer"
import { Keymap } from "../kernel/keymap"
import { defineMode } from "./mode"

const BUFFER_LIST_NAME = "*Buffer List*"
const NAME_WIDTH = 24

const bufferListIds = new WeakMap<BufferModel, string[]>()

export function installBufferListMode(): void {
  const keymap = new Keymap("buffer-list-map")
  keymap.bind("enter", "Buffer-menu-select")
  keymap.bind("return", "Buffer-menu-select")
  keymap.bind("C-m", "Buffer-menu-select")
  defineMode({ name: "buffer-list", parent: "text", keymap })
}

export function showBufferList(editor: Editor, options: { filesOnly?: boolean } = {}): BufferModel {
  const existing = [...editor.buffers.values()].find(b => b.name === BUFFER_LIST_NAME)
  const buffer = existing ?? new BufferModel({ name: BUFFER_LIST_NAME, kind: "scratch", mode: "buffer-list" })
  if (!existing) editor.addBuffer(buffer)
  renderBufferList(editor, buffer, options)
  buffer.readOnly = true
  editor.enterMode(buffer, "buffer-list")
  editor.switchToBuffer(buffer.id)
  void editor.changed("buffer-list")
  return buffer
}

export function renderBufferList(editor: Editor, buffer: BufferModel, options: { filesOnly?: boolean } = {}): void {
  const ids: string[] = []
  const lines = [...editor.buffers.values()]
    .filter(b => b.kind !== "minibuffer")
    .filter(b => !options.filesOnly || b.path)
    .map(b => {
      ids.push(b.id)
      const current = b.id === editor.currentBufferId ? "." : " "
      const dirty = b.dirty ? "*" : " "
      const path = b.path ? `  ${b.path}` : ""
      return `${current}${dirty}  ${editor.bufferDisplayName(b).padEnd(NAME_WIDTH)} ${b.mode}${path}`
    })
  bufferListIds.set(buffer, ids)
  buffer.setText(lines.join("\n"), false)
}

export function bufferListEntryAtPoint(buffer: BufferModel): string | undefined {
  const lineNo = buffer.text.slice(0, buffer.point).split("\n").length - 1
  return bufferListIds.get(buffer)?.[lineNo]
}
