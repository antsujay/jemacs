import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { MemCas } from "../../src/shadow/cas"
import { announceBuffer, attachAuthority, attachShadow, shadowState } from "../../src/shadow/shadow"
import type { ShadowLink, ShadowOp } from "../../src/shadow/shadow"
import { FakeLink } from "../shadow/fake-link"

// t-qa-1c24ff83 [feature]: A auto-switches S to its file-argv buffer on connect.
// Before: `jemacs --web --shadow foo.ts` → A shows foo.ts, browser S shows *scratch*.
// After: announceBuffer(A, currentBufferId) ships {kind:command,name:switch-to-buffer,
// args:[id]} after the buffer-ref; S honors it (the one A→S Cmd it accepts).

function rig() {
  const A = new Editor()
  const S = new Editor()
  const { sLink, aLink } = FakeLink.pair()
  const toS: ShadowOp[] = []
  const send = aLink.send.bind(aLink)
  aLink.send = op => { toS.push(op); send(op) }
  attachAuthority(A, aLink, { cas: new MemCas(), flushMs: 0 })
  attachShadow(S, sLink, { cas: new MemCas() })
  const drain = () => { while (sLink.inflight.length || aLink.inflight.length) { sLink.drainSide(); aLink.drainSide() } }
  return { A, S, sLink, aLink, toS, drain }
}

test("connect: S lands on A's current (file-argv) buffer, not *scratch*", () => {
  const { A, S, toS, drain } = rig()
  // A opened a file from argv.
  const file = A.addBuffer(new BufferModel({ id: "f1", name: "foo.ts", path: "/p/foo.ts", text: "let x\n", kind: "file" }))
  A.switchToBuffer(file.id)
  expect(A.currentBufferId).toBe("f1")
  expect(S.currentBuffer.name).toBe("*scratch*")

  // host.ts: announce every A buffer to the freshly-connected S.
  for (const b of A.buffers.values()) announceBuffer(A, b.id)
  drain()

  // A shipped buffer-ref(f1) then command(switch-to-buffer, f1).
  const cmd = toS.find(o => o.kind === "command")
  expect(cmd).toEqual({ kind: "command", name: "switch-to-buffer", args: ["f1"], seq: 0 })
  expect(toS.findIndex(o => o.kind === "buffer-ref") < toS.findIndex(o => o.kind === "command")).toBe(true)

  // S created the mirror AND selected it.
  expect(S.buffers.get("f1")?.text).toBe("let x\n")
  expect(S.currentBufferId).toBe("f1")
})

test("Cmd reordered ahead of buffer-ref: switch lands when the buffer arrives", () => {
  // IdbCas's async lookup means the buffer-ref handler can yield past the Cmd.
  // S stashes the target id and applies it once the buffer materializes.
  const A = new Editor()
  const S = new Editor()
  let sRecv: (op: ShadowOp) => void = () => {}
  const sLink: ShadowLink = { peerId: "A", role: "shadow", trust: "full", send: () => {}, on: h => { sRecv = h }, close: () => {} }
  attachShadow(S, sLink, { cas: new MemCas() })

  // Cmd first, buffer-ref second — the bad ordering.
  sRecv({ kind: "command", name: "switch-to-buffer", args: ["f1"], seq: 0 })
  expect(S.buffers.has("f1")).toBe(false)
  expect(S.currentBuffer.name).toBe("*scratch*") // not yet — no phantom buffer minted
  expect(shadowState(S)!.wantCurrent).toBe("f1")

  sRecv({ kind: "buffer-ref", id: "f1", name: "foo.ts", path: "/p/foo.ts", sha: "deadbeef", mode: "typescript" })
  expect(S.currentBufferId).toBe("f1")
  void A
})

test("non-current buffer announce does not send switch-to-buffer", () => {
  const { A, toS, drain } = rig()
  A.addBuffer(new BufferModel({ id: "f1", name: "foo.ts", path: "/p/foo.ts", text: "", kind: "file" }))
  // A stays on *scratch* (no file argv).
  expect(A.currentBuffer.name).toBe("*scratch*")

  for (const b of A.buffers.values()) announceBuffer(A, b.id)
  drain()

  expect(toS.some(o => o.kind === "command")).toBe(false)
})
