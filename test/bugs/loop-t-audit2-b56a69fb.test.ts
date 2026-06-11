import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { MemCas } from "../../src/shadow/cas"
import { attachAuthority, attachShadow } from "../../src/shadow/shadow"
import { initialSync } from "../../src/shadow/install"
import { FakeLink } from "../shadow/fake-link"

// t-audit2-b56a69fb: Authority's active buffer never displayed on Shadow —
// modeline shows *scratch*, not guide.md. host.ts `attachShadowLink` announces
// every buffer (`announceBuffer`) so S *has* guide.md, but nothing tells S
// which one A had selected, so S stays on its own *scratch*. The fix lives in
// install.ts: `initialSync(A)` announces A's state (selected buffer first +
// layout) and wires S to adopt it.
//
// Repro mirrors do_not_commit/qa-shadow.ts step (1): server starts with
// `docs/guide.md` open, browser shadow connects, modeline should show guide.md.

async function settle(a: FakeLink, s: FakeLink): Promise<void> {
  for (let idle = 0; idle < 4; ) {
    const n = a.drain() + s.drain()
    await new Promise(r => setTimeout(r, 0))
    idle = n === 0 && a.inflight.length === 0 && s.inflight.length === 0 ? idle + 1 : 0
  }
}

test("initialSync: S adopts A's selected buffer on connect", async () => {
  // A: server started with guide.md open and selected (qa-shadow.ts spawn argv).
  const A = new Editor()
  const guide = A.addBuffer(new BufferModel({
    id: "guide", name: "guide.md", path: "/docs/guide.md", text: "# Guide\n",
  }))
  A.switchToBuffer(guide.id)
  expect(A.currentBuffer.name).toBe("guide.md")

  // S: fresh browser shadow — sitting on its own *scratch*.
  const S = new Editor()
  expect(S.currentBuffer.name).toBe("*scratch*")

  const { sLink, aLink } = FakeLink.pair()
  const cas = new MemCas()
  attachAuthority(A, aLink, { cas, flushMs: 0 })
  attachShadow(S, sLink, { cas })

  // The fix: install.ts owns the initial-state handshake. Same call on both
  // sides — role-dispatched on authorityState/shadowState.
  initialSync(S)
  initialSync(A)
  await settle(aLink, sLink)

  // S now mirrors A's selection — modeline would render guide.md, not *scratch*.
  expect(S.buffers.get("guide")?.text).toBe("# Guide\n")
  expect(S.currentBuffer.id).toBe("guide")
  expect(S.currentBuffer.path).toBe("/docs/guide.md")
})

test("initialSync: only the first announced (= A's selected) buffer auto-selects on S", async () => {
  const A = new Editor()
  const other = A.addBuffer(new BufferModel({ id: "other", name: "other.ts", path: "/other.ts", text: "x" }))
  const guide = A.addBuffer(new BufferModel({ id: "guide", name: "guide.md", path: "/guide.md", text: "g" }))
  A.switchToBuffer(guide.id) // guide selected; other is just open

  const S = new Editor()
  const { sLink, aLink } = FakeLink.pair()
  const cas = new MemCas()
  attachAuthority(A, aLink, { cas, flushMs: 0 })
  attachShadow(S, sLink, { cas })
  initialSync(S)
  initialSync(A)
  await settle(aLink, sLink)

  // Both arrived, but S switched to guide (A's selection), not other.
  expect(S.buffers.has("other")).toBe(true)
  expect(S.buffers.has("guide")).toBe(true)
  expect(S.currentBuffer.id).toBe("guide")
})
