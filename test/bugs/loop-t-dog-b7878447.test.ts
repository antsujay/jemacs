import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { MemCas } from "../../src/shadow/cas"
import { announceBuffer, attachAuthority, attachShadow } from "../../src/shadow/shadow"
import { FakeLink } from "../shadow/fake-link"

// t-dog-b7878447: announced buffer arrives on S with dirty=true and point at
// EOF. Chunk reassembly used replaceRange(0, len, text) — markDirty defaults
// true and point is forced to start+replacement.length. A freshly synced
// buffer should land clean with point at the beginning, same as find-file.
//
// t-dog-bbc9c1fd (merged): same root cause — README.md/guide.md show the `*`
// dirty marker on arrival and switch-to-buffer lands at line 261 instead of 1.

function rig() {
  const A = new Editor()
  const S = new Editor()
  const { sLink, aLink } = FakeLink.pair()
  attachAuthority(A, aLink, { cas: new MemCas(), flushMs: 0 })
  attachShadow(S, sLink, { cas: new MemCas() })
  const drain = () => { while (sLink.inflight.length || aLink.inflight.length) { sLink.drainSide(); aLink.drainSide() } }
  return { A, S, drain }
}

test("shadow: chunk-reassembled buffer arrives clean with point at 0", () => {
  const { A, S, drain } = rig()
  const text = Array.from({ length: 261 }, (_, i) => `line ${i + 1}`).join("\n") + "\n"
  A.addBuffer(new BufferModel({ id: "g1", name: "guide.md", path: "/docs/guide.md", text, kind: "file" }))

  // S's CAS is empty → miss → Want → Chunks → reassembly.
  announceBuffer(A, "g1")
  drain()

  const bufS = S.buffers.get("g1")!
  expect(bufS.text).toBe(text)
  expect(bufS.dirty).toBe(false)
  expect(bufS.point).toBe(0)
})

test("shadow: CAS-hit into existing buffer arrives clean with point at 0", () => {
  const { A, S, drain } = rig()
  const sCas = new MemCas()
  // Re-attach S with a CAS that already has the text → hit path, not chunks.
  const S2 = new Editor()
  const { sLink, aLink } = FakeLink.pair()
  attachAuthority(A, aLink, { cas: new MemCas(), flushMs: 0 })
  attachShadow(S2, sLink, { cas: sCas })
  const drain2 = () => { while (sLink.inflight.length || aLink.inflight.length) { sLink.drainSide(); aLink.drainSide() } }
  void S; void drain

  const text = "alpha\nbeta\ngamma\n"
  sCas.write(text)
  A.addBuffer(new BufferModel({ id: "f1", name: "foo.md", text, kind: "file" }))
  // S already has the buffer open (e.g. stale placeholder from a prior session).
  S2.addBuffer(new BufferModel({ id: "f1", name: "foo.md", text: "stale", kind: "file" }))

  announceBuffer(A, "f1")
  drain2()

  const bufS = S2.buffers.get("f1")!
  expect(bufS.text).toBe(text)
  expect(bufS.dirty).toBe(false)
  expect(bufS.point).toBe(0)
})
