import { homedir } from "node:os"
import { join, resolve } from "node:path"
import type { BookmarkRecord } from "./store"

/** Expand `~` the way Emacs `expand-file-name` does for bookmark paths. */
export function expandBookmarkFilename(path: string): string {
  const dir = path.endsWith("/")
  let expanded: string
  if (path === "~" || path === "~/") expanded = homedir()
  else if (path.startsWith("~/")) expanded = resolve(homedir(), path.slice(2))
  else expanded = resolve(path)
  if (dir && !expanded.endsWith("/")) return `${expanded}/`
  return expanded
}

type LispValue = string | number | LispPair | LispValue[]

type LispPair = { tag: "pair"; car: LispValue; cdr: LispValue }

function skipWs(src: string, i: number): number {
  while (i < src.length && /\s/.test(src[i]!)) i++
  return i
}

function readAtom(src: string, i: number): [LispValue, number] {
  const start = i
  while (i < src.length && !/[\s()";]/.test(src[i]!)) i++
  const raw = src.slice(start, i)
  if (/^-?\d+(\.\d+)?$/.test(raw)) return [Number(raw), i]
  return [raw, i]
}

function readString(src: string, i: number): [string, number] {
  i++ // opening quote
  let out = ""
  while (i < src.length) {
    const ch = src[i]!
    if (ch === '"') return [out, i + 1]
    if (ch === "\\" && i + 1 < src.length) {
      const esc = src[i + 1]!
      const mapped = esc === "n" ? "\n" : esc === "t" ? "\t" : esc === "r" ? "\r" : esc
      out += mapped
      i += 2
      continue
    }
    out += ch
    i++
  }
  throw new Error("unterminated string in Emacs bookmark file")
}

function readSexp(src: string, i: number): [LispValue, number] {
  i = skipWs(src, i)
  const ch = src[i]
  if (ch === '"') return readString(src, i)
  if (ch === "(") {
    i++
    i = skipWs(src, i)
    if (src[i] === ")") return [[], i + 1]
    const [first, i2] = readSexp(src, i)
    i = skipWs(src, i2)
    if (src[i] === ".") {
      const [cdr, i3] = readSexp(src, i + 1)
      i = skipWs(src, i3)
      if (src[i] !== ")") throw new Error("expected ) after dotted pair")
      return [{ tag: "pair", car: first, cdr }, i + 1]
    }
    const items: LispValue[] = [first]
    while (true) {
      i = skipWs(src, i)
      if (src[i] === ")") return [items, i + 1]
      const [item, next] = readSexp(src, i)
      items.push(item)
      i = next
    }
  }
  if (ch === ")") throw new Error("unexpected )")
  return readAtom(src, i)
}

function pairValue(v: LispValue): [string, LispValue] | null {
  if (typeof v !== "object" || v === null || Array.isArray(v) || !("tag" in v)) return null
  const key = v.car
  if (typeof key !== "string") return null
  return [key, v.cdr]
}

function alistLookup(alist: LispValue[], key: string): LispValue | undefined {
  for (const entry of alist) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    if (entry[0] === key) return entry[1]
    const pair = pairValue(entry[0]!)
    if (pair && pair[0] === key) return pair[1]
  }
  for (const entry of alist) {
    const pair = pairValue(entry)
    if (pair && pair[0] === key) return pair[1]
  }
  return undefined
}

function asString(v: LispValue | undefined): string | undefined {
  return typeof v === "string" ? v : undefined
}

function asNumber(v: LispValue | undefined): number | undefined {
  return typeof v === "number" ? v : undefined
}

/** Parse `~/.emacs.d/bookmarks` (Emacs bookmark-format-version 1). */
export function parseEmacsBookmarkFile(text: string): Record<string, BookmarkRecord> {
  const stripped = text.replace(/^;.*$/gm, "").trim()
  if (!stripped) return {}
  const pos = { i: 0 }
  const [root] = readSexp(stripped, pos.i)
  if (!Array.isArray(root)) throw new Error("Emacs bookmark file root must be a list")
  const out: Record<string, BookmarkRecord> = {}
  for (const entry of root) {
    if (!Array.isArray(entry) || entry.length < 2) continue
    const name = entry[0]
    if (typeof name !== "string") continue
    const props = entry.slice(1)
    const filename = asString(alistLookup(props, "filename"))
    if (!filename) continue
    const position = asNumber(alistLookup(props, "position"))
    out[name] = {
      filename: expandBookmarkFilename(filename),
      position: position != null ? Math.max(0, position - 1) : 0,
      frontContext: asString(alistLookup(props, "front-context-string")),
      rearContext: asString(alistLookup(props, "rear-context-string")),
    }
  }
  return out
}

export function defaultEmacsBookmarkFile(): string {
  return join(homedir(), ".emacs.d", "bookmarks")
}
