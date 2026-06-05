import { describe, expect, test } from "bun:test"
import { BufferModel } from "../../src/kernel/buffer"

// Seeded LCG so failures are reproducible. fast-check is the upgrade (shrinking).
function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

function checkInvariants(b: BufferModel, where: string): void {
  const len = b.text.length
  expect(b.point >= 0 && b.point <= len, `${where}: point ${b.point} ∉ [0,${len}]`).toBe(true)
  if (b.mark != null) {
    expect(b.mark >= 0 && b.mark <= len, `${where}: mark ${b.mark} ∉ [0,${len}]`).toBe(true)
  }
}

type Op =
  | { k: "splice"; from: number; to: number; repl: string }
  | { k: "insert"; s: string }
  | { k: "del"; dir: 1 | -1 }
  | { k: "move"; d: number }
  | { k: "setMark" }
  | { k: "undo" }

function genOp(r: () => number, len: number): Op {
  const pick = Math.floor(r() * 6)
  const str = (n: number) => Array.from({ length: n }, () => "abcde\n"[Math.floor(r() * 6)]).join("")
  switch (pick) {
    case 0: return { k: "splice", from: Math.floor(r() * (len + 2)) - 1, to: Math.floor(r() * (len + 2)) - 1, repl: str(Math.floor(r() * 5)) }
    case 1: return { k: "insert", s: str(1 + Math.floor(r() * 4)) }
    case 2: return { k: "del", dir: r() < 0.5 ? 1 : -1 }
    case 3: return { k: "move", d: Math.floor(r() * 7) - 3 }
    case 4: return { k: "setMark" }
    default: return { k: "undo" }
  }
}

function apply(b: BufferModel, op: Op): void {
  switch (op.k) {
    case "splice": b.replaceRange(op.from, op.to, op.repl); break
    case "insert": b.insert(op.s); break
    case "del": op.dir > 0 ? b.deleteForward() : b.deleteBackward(); break
    case "move": b.move(op.d); break
    case "setMark": b.setMark(); break
    case "undo": b.undo(); break
  }
}

describe("property/buffer", () => {
  for (const seed of [1, 42, 1337, 0xdead, 12345]) {
    test(`invariants hold under 200 random ops (seed=${seed})`, () => {
      const r = rng(seed)
      const b = new BufferModel({ name: "fuzz", text: "hello\nworld\n" })
      const trace: Op[] = []
      for (let i = 0; i < 200; i++) {
        const op = genOp(r, b.text.length)
        trace.push(op)
        try {
          apply(b, op)
        } catch (e) {
          throw new Error(`op ${i} threw: ${JSON.stringify(op)}\ntrace: ${JSON.stringify(trace)}\n${e}`)
        }
        checkInvariants(b, `seed=${seed} op=${i} ${JSON.stringify(op)}`)
      }
    })
  }

  test("onTextChange delta matches actual text diff", () => {
    const r = rng(99)
    const b = new BufferModel({ name: "fuzz", text: "abcdef" })
    let before = b.text
    b.onTextChange = ({ start, end, text }) => {
      const expected = before.slice(0, start) + text + before.slice(end)
      // capture before mutation; verify after via queueMicrotask is racy, so just record
      before = expected
    }
    for (let i = 0; i < 100; i++) {
      apply(b, genOp(r, b.text.length))
      expect(b.text).toBe(before)
    }
  })

  test("undo restores exact prior text", () => {
    const b = new BufferModel({ name: "fuzz", text: "start" })
    const snapshots: string[] = [b.text]
    const r = rng(7)
    for (let i = 0; i < 50; i++) {
      const op = genOp(r, b.text.length)
      if (op.k === "undo" || op.k === "move" || op.k === "setMark") continue
      const before = b.text
      apply(b, op)
      if (b.text !== before) snapshots.push(b.text)
    }
    while (snapshots.length > 1) {
      b.undo()
      snapshots.pop()
      expect(b.text).toBe(snapshots[snapshots.length - 1])
    }
  })
})
