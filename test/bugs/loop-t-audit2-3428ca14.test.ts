import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { MemCas, sha256 } from "../../src/shadow/cas"
import type { FsLike, ManifestDelta } from "../../src/shadow/manifest"
import type { ShadowLink, ShadowOp } from "../../src/shadow/shadow"
import { attachAuthority, attachShadow, shadowState } from "../../src/shadow/shadow"
import { FakeFs } from "../shadow/fake-fs"
import { FakeLink } from "../shadow/fake-link"

import { MAX_SENT } from "../../src/shadow/shadow"

// t-audit2-3428ca14: AuthorityFs.watch drops events that arrive during a rebuild.
// t-audit2-c08f5f47: AuthorityFs.watch rebuilds + hashes the entire tree on every event.
// t-audit2-2893cfe0: ShadowState.sent grows unbounded — pruned only on rebase, never on ack.

async function settle(a: FakeLink, s: FakeLink): Promise<void> {
  for (let idle = 0; idle < 4; ) {
    const n = a.drain() + s.drain()
    await new Promise(r => setTimeout(r, 0))
    idle = n === 0 && a.inflight.length === 0 && s.inflight.length === 0 ? idle + 1 : 0
  }
}

test("watch: event arriving mid-rebuild is queued + rehash is incremental", async () => {
  const fs = new FakeFs()
  fs.mkdir("/w")
  for (const f of ["a", "b", "c", "d", "e"]) fs.writeFile(`/w/${f}.txt`, "v1")

  let reads = 0
  let onRead: (() => void) | undefined
  const slow: FsLike = {
    stat: p => { const s = fs.stat(p); return { mode: s.mode, size: s.content.length, mtime: s.mtime } },
    readdir: d => fs.readdir(d),
    // Capture content first, then yield: a write fired in onRead lands after this
    // read has already returned stale text — the real-fs race the queue must absorb.
    readFile: async p => { reads++; const t = fs.readFile(p); await 0; onRead?.(); onRead = undefined; return t },
  }

  const { sLink, aLink } = FakeLink.pair()
  const sent: ShadowOp[] = []
  sLink.on(op => sent.push(op))
  const detach = attachAuthority(new Editor(), aLink, {
    fs: slow, fsRoot: "/", watcher: cb => fs.onChange(c => cb(c)), cas: new MemCas(), flushMs: 0,
  })
  await settle(aLink, sLink)
  const seedReads = reads

  // Change b.txt → rebuild starts; on its first readFile, change a.txt. The old
  // full-tree walk has already captured a.txt by then, and the second event hits
  // building=true → dropped. New code queues it and rehashes only the two paths.
  onRead = () => fs.writeFile("/w/a.txt", "v2")
  fs.writeFile("/w/b.txt", "v2")
  await settle(aLink, sLink)

  const deltas = sent.filter(o => o.kind === "manifest-delta") as ManifestDelta[]
  const aEntry = deltas.flatMap(d => d.changes).find(c => c.path === "/w/a.txt")
  expect(aEntry?.new?.sha).toBe(sha256("v2"))
  // Two single-file changes shouldn't re-read the whole 5-file tree.
  expect(reads - seedReads).toBeLessThan(5)
  detach()
})

test("ShadowState.sent is bounded (capped at MAX_SENT, not unbounded)", () => {
  let sRecv: (op: ShadowOp) => void = () => {}
  let aRecv: (op: ShadowOp) => void = () => {}
  const sLink: ShadowLink = { peerId: "A", role: "shadow", trust: "full", send: op => aRecv(op), on: h => { sRecv = h }, close: () => {} }
  const aLink: ShadowLink = { peerId: "S", role: "authority", trust: "full", send: op => sRecv(op), on: h => { aRecv = h }, close: () => {} }

  const S = new Editor(), A = new Editor()
  S.addBuffer(new BufferModel({ id: "b1", name: "t", text: "" }))
  A.addBuffer(new BufferModel({ id: "b1", name: "t", text: "" }))
  attachAuthority(A, aLink, { flushMs: 0 })
  attachShadow(S, sLink)

  const buf = S.buffers.get("b1")!
  const N = MAX_SENT + 20
  for (let i = 0; i < N; i++) buf.replaceRange(buf.text.length, buf.text.length, "x")

  const st = shadowState(S)!
  expect(st.pending.get("b1")?.length ?? 0).toBe(0)
  // Ack can't safely prune (a reordered rebase still needs the entries — see
  // t-f360d582), so the bound is a push-time cap, not zero.
  expect(st.sent.get("b1")?.length).toBe(MAX_SENT)
  // Eviction folds the dropped tail's bufSeq into baseBufSeq, so the rebase
  // mapping for any op within the window is still exact.
  expect(st.baseBufSeq.get("b1")).toBe(buf.seq - MAX_SENT)
  // And A converged on the same text — eviction didn't drop anything in flight.
  expect(A.buffers.get("b1")!.text).toBe(buf.text)
})
