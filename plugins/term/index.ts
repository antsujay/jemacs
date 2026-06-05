import type { BufferModel } from "../../src/kernel/buffer"
import type { Pty } from "./pty"
import { sessions as v2Sessions } from "../term-v2"

// term-v2 is the only term plugin loaded at startup; this module is a
// backward-compat surface for tests that imported v1 symbols directly.
export { install, keyToPtyBytes, termRawMap } from "../term-v2"

export type TermState = { pty: Pty; lines: string[]; row: number; col: number }

/** Same WeakMap instance as term-v2's; legacy tests inject TermState-shaped
 *  stubs, and v2's commands only touch `.pty` on the session object. */
export const sessions = v2Sessions as unknown as WeakMap<BufferModel, TermState>

/** v1 line-array renderer: maintain a line array; CR rewinds column, LF
 *  advances row. Strip CSI/OSC. Kept only for the tests that exercise its
 *  undo-snapshot behaviour directly — not wired into install(). */
export function feed(state: TermState, buffer: BufferModel, chunk: string): void {
  const clean = chunk
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")   // OSC
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")               // CSI
    .replace(/\x1b[=><]/g, "")                             // keypad mode
  for (const ch of clean) {
    if (ch === "\r") { state.col = 0; continue }
    if (ch === "\n") { state.row++; state.lines[state.row] ??= ""; continue }
    if (ch === "\b") { state.col = Math.max(0, state.col - 1); continue }
    if (ch === "\x07" || ch < " ") continue
    const line = state.lines[state.row] ?? ""
    state.lines[state.row] = line.slice(0, state.col) + ch + line.slice(state.col + 1)
    state.col++
  }
  // Streamed output is the common case: append the delta past the shared
  // prefix so we don't push a full-buffer undo snapshot per pty chunk.
  const next = state.lines.join("\n")
  const old = buffer.text
  let i = 0
  const max = Math.min(old.length, next.length)
  while (i < max && old[i] === next[i]) i++
  if (i === old.length) buffer.append(next.slice(i))
  else buffer.setText(next, false, false)
  buffer.point = buffer.text.length
}
