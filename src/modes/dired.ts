import { basename, dirname, join, resolve } from "node:path"
import { readdir, stat } from "node:fs/promises"
import { BufferModel } from "../kernel/buffer"
import { Keymap } from "../kernel/keymap"
import { defineMode, type TextSpan } from "./mode"

export type DiredEntry = {
  name: string
  path: string
  isDirectory: boolean
  size: number
  mtime: Date
}

const diredEntryLines = new WeakMap<BufferModel, DiredEntry[]>()

export function installDiredMode(): void {
  const keymap = new Keymap("dired-map")
  keymap.bind("enter", "dired-find-file")
  keymap.bind("g", "dired-revert")
  keymap.bind("^", "dired-up-directory")
  keymap.bind("q", "quit-window")
  defineMode({ name: "dired", parent: "text", keymap, fontLock: diredFontLock })
}

export async function makeDiredBuffer(path: string): Promise<BufferModel> {
  const dir = resolve(path)
  const buffer = new BufferModel({ name: `${basename(dir) || dir}/`, path: dir, kind: "directory", mode: "dired" })
  buffer.readOnly = true
  await refreshDiredBuffer(buffer)
  return buffer
}

export async function refreshDiredBuffer(buffer: BufferModel): Promise<void> {
  if (!buffer.path) throw new Error(`Dired buffer ${buffer.name} has no directory path`)
  const names = await readdir(buffer.path)
  const entries: DiredEntry[] = [
    await entryFor(buffer.path, "."),
    await entryFor(dirname(buffer.path), ".."),
  ]
  for (const name of names.sort((a, b) => a.localeCompare(b))) entries.push(await entryFor(buffer.path, name))

  const lines = [`  Directory ${buffer.path}`, "", ...entries.map(formatEntry)]
  const wasReadOnly = buffer.readOnly
  buffer.readOnly = false
  buffer.setText(lines.join("\n"), false)
  buffer.point = Math.min(buffer.point, buffer.text.length)
  buffer.dirty = false
  buffer.readOnly = wasReadOnly
  diredEntryLines.set(buffer, entries)
}

export function diredEntryAtPoint(buffer: BufferModel): DiredEntry | undefined {
  const lineNo = buffer.text.slice(0, buffer.point).split("\n").length
  return diredEntryLines.get(buffer)?.[lineNo - 3]
}

export function diredFontLock(buffer: BufferModel): TextSpan[] {
  const spans: TextSpan[] = []
  let offset = 0
  for (const line of buffer.text.split("\n")) {
    const nameStart = line.indexOf("  ", 12)
    if (line.startsWith("d") && nameStart !== -1) spans.push({ start: offset + nameStart + 2, end: offset + line.length, face: "directory" })
    offset += line.length + 1
  }
  return spans
}

function formatEntry(entry: DiredEntry): string {
  const type = entry.isDirectory ? "d" : "-"
  const size = entry.isDirectory ? "     " : entry.size.toString().padStart(5)
  const date = entry.mtime.toISOString().slice(0, 10)
  return `${type} ${size} ${date}  ${entry.name}${entry.isDirectory && !entry.name.endsWith("/") ? "/" : ""}`
}

async function entryFor(parent: string, name: string): Promise<DiredEntry> {
  const path = name === "." ? parent : name === ".." ? parent : join(parent, name)
  const info = await stat(path)
  return { name, path, isDirectory: info.isDirectory(), size: info.size, mtime: info.mtime }
}
