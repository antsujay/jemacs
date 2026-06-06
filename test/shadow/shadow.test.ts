import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { attachAuthority, attachShadow, shadowState, type ShadowLink, type ShadowOp } from "../../src/shadow/shadow"

/** Hand-wired in-process pair: each side's `send` synchronously invokes the other's `on` handler. */
function linkPair(): [ShadowLink, ShadowLink] {
  let sRecv: (op: ShadowOp) => void = () => {}
  let aRecv: (op: ShadowOp) => void = () => {}
  const sLink: ShadowLink = {
    peerId: "A", role: "shadow", trust: "full",
    send: op => aRecv(op),
    on: h => { sRecv = h },
    close: () => {},
  }
  const aLink: ShadowLink = {
    peerId: "S", role: "authority", trust: "full",
    send: op => sRecv(op),
    on: h => { aRecv = h },
    close: () => {},
  }
  return [sLink, aLink]
}

function pair(): { S: Editor; A: Editor; bufS: BufferModel; bufA: BufferModel; detach: () => void } {
  const S = new Editor()
  const A = new Editor()
  // Explicit shared id so ops route to the same logical buffer on both sides (DESIGN.md §Determinism).
  const bufS = S.addBuffer(new BufferModel({ id: "buf-1", name: "test", text: "" }))
  const bufA = A.addBuffer(new BufferModel({ id: "buf-1", name: "test", text: "" }))
  const [sLink, aLink] = linkPair()
  const dA = attachAuthority(A, aLink)
  const dS = attachShadow(S, sLink)
  return { S, A, bufS, bufA, detach: () => { dS(); dA() } }
}

test("type on S → A receives → ack → S.pending empty", () => {
  const { S, bufS, bufA, detach } = pair()

  bufS.insert("hello")

  // A received and applied S's splice.
  expect(bufA.text).toBe("hello")
  // Ack round-tripped synchronously: pending drained.
  const pending = shadowState(S)!.pending.get("buf-1") ?? []
  expect(pending.length).toBe(0)
  expect(bufS.locals.get("shadow-pending")).toEqual([])
  // S and A converged.
  expect(bufS.text).toBe(bufA.text)

  detach()
})

test("multiple edits ack in order; pending tracks the unacked tail", () => {
  const S = new Editor()
  const A = new Editor()
  const bufS = S.addBuffer(new BufferModel({ id: "buf-1", name: "test", text: "" }))
  const bufA = A.addBuffer(new BufferModel({ id: "buf-1", name: "test", text: "" }))

  // Queue ops instead of delivering, so we can observe pending before ack.
  const toA: ShadowOp[] = []
  const toS: ShadowOp[] = []
  let sRecv: (op: ShadowOp) => void = () => {}
  let aRecv: (op: ShadowOp) => void = () => {}
  const sLink: ShadowLink = { peerId: "A", role: "shadow", trust: "full", send: op => toA.push(op), on: h => { sRecv = h }, close: () => {} }
  const aLink: ShadowLink = { peerId: "S", role: "authority", trust: "full", send: op => toS.push(op), on: h => { aRecv = h }, close: () => {} }
  attachAuthority(A, aLink)
  attachShadow(S, sLink)

  bufS.insert("ab")
  bufS.insert("c")
  expect(shadowState(S)!.pending.get("buf-1")!.length).toBe(2)
  expect(toA.map(o => o.kind)).toEqual(["splice", "splice"])

  // Deliver first splice to A → A acks seq 1.
  aRecv(toA[0]!)
  expect(bufA.text).toBe("ab")
  expect(toS[0]).toEqual({ kind: "ack", upTo: 1 })
  sRecv(toS[0]!)
  expect(shadowState(S)!.pending.get("buf-1")!.length).toBe(1)

  // Deliver second.
  aRecv(toA[1]!)
  expect(bufA.text).toBe("abc")
  sRecv(toS[1]!)
  expect(shadowState(S)!.pending.get("buf-1")!.length).toBe(0)
})

test("detach unhooks: edits no longer cross the link", () => {
  const { S, bufS, bufA, detach } = pair()
  bufS.insert("x")
  expect(bufA.text).toBe("x")
  detach()
  bufS.insert("y")
  expect(bufA.text).toBe("x")
  expect(shadowState(S)).toBeUndefined()
  expect(bufS.link).toBeUndefined()
})

test("ctx.onDispose registers detach", () => {
  const S = new Editor()
  const A = new Editor()
  S.addBuffer(new BufferModel({ id: "buf-1", name: "test", text: "" }))
  A.addBuffer(new BufferModel({ id: "buf-1", name: "test", text: "" }))
  const [sLink, aLink] = linkPair()
  const disposers: Array<() => void> = []
  const ctx = { onDispose: (fn: () => void) => disposers.push(fn) }
  attachAuthority(A, aLink, ctx)
  attachShadow(S, sLink, ctx)
  expect(disposers.length).toBe(2)
  for (const d of disposers) d()
  expect(shadowState(S)).toBeUndefined()
})
