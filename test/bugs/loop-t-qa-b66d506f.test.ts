import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { MemCas } from "../../src/shadow/cas"
import { announceBuffer, attachAuthority, attachShadow } from "../../src/shadow/shadow"
import type { ShadowOp } from "../../src/shadow/ops"
import { FakeLink } from "../shadow/fake-link"

// t-qa-b66d506f: announceBuffer ships only `path`, S sets name=path → C-x b
// by basename creates a fresh empty buffer instead of finding the announced one.
// Repro of `--web --shadow`: A opens /…/docs/guide.md (name "guide.md"); user
// on S types `C-x b guide.md RET` and lands in an empty scratch buffer.
//
// Fix: BufferRef carries {name, path, mode}; S addBuffer with that name.
// announceBuffer also skips *scratch*/*messages*/minibuffer — S has its own.

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
  return { A, S, toS, drain }
}

test("announceBuffer: S buffer is named by basename so C-x b finds it", () => {
  const { A, S, drain } = rig()
  const bufA = A.addBuffer(new BufferModel({
    id: "g1", name: "guide.md", path: "/home/user/project/docs/guide.md", text: "# Guide\n", kind: "file",
  }))

  announceBuffer(A, bufA.id)
  drain()

  const bufS = S.buffers.get("g1")
  expect(bufS?.text).toBe("# Guide\n")
  expect(bufS?.path).toBe("/home/user/project/docs/guide.md")
  expect(bufS?.mode).toBe(bufA.mode)
  // The actual bug: name was the full path, so switchToBuffer("guide.md") missed.
  expect(bufS?.name).toBe("guide.md")

  // C-x b guide.md → must land on the announced buffer, not mint an empty one.
  const switched = S.switchToBuffer("guide.md")
  expect(switched.id).toBe("g1")
  expect(switched.text).toBe("# Guide\n")
  expect([...S.buffers.values()].filter(b => b.name === "guide.md").length).toBe(1)
})

test("announceBuffer: skips *scratch*/*messages*/minibuffer", () => {
  const { A, toS, drain } = rig()
  // A's constructor already created *scratch* + *messages*.
  A.addBuffer(new BufferModel({ name: " *minibuf-0*", kind: "minibuffer" }))
  A.addBuffer(new BufferModel({ id: "f1", name: "foo.ts", path: "/p/foo.ts", text: "x", kind: "file" }))

  for (const b of A.buffers.values()) announceBuffer(A, b.id)
  drain()

  const refs = toS.filter(o => o.kind === "buffer-ref")
  expect(refs.length).toBe(1)
  expect(refs[0]).toMatchObject({ id: "f1", name: "foo.ts", path: "/p/foo.ts" })
})
