/**
 * t-audit2-c08f5f47: AuthorityFs.watch rebuilt + hashed the entire tree on
 *   every watcher event. Fix: `watchAuthorityFs` re-reads only the changed
 *   path then bubbles dirHash up its ancestors — O(depth), not O(tree).
 *
 * merged t-audit2-2893cfe0: ShadowState.sent grew unbounded — only rebase
 *   pruned it. Ack-time pruning is unsafe under reorder (t-f360d582), so the
 *   fix is a push-time cap (MAX_SENT) that folds the evicted entry's bufSeq
 *   into baseBufSeq.
 */
import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { attachAuthority, attachShadow, MAX_SENT, shadowState } from "../../src/shadow/shadow"
import type { ShadowLink } from "../../src/shadow/link"
import type { ShadowOp } from "../../src/shadow/ops"
import type { FsLike } from "../../src/shadow/manifest"
import type { FsWatcher } from "../../src/shadow/remote-runtime"
import { MemCas } from "../../src/shadow/cas"
import { FakeFs } from "../shadow/fake-fs"

const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0)) }

function stubLink(role: ShadowLink["role"], sent: ShadowOp[]): ShadowLink {
  return { peerId: "p", role, trust: "full", send: o => sent.push(o), on: () => {}, close: () => {} }
}

// ── c08f5f47: one watcher event ⇒ one readFile, not N ───────────────────────

test("watcher event rehashes only the changed path's ancestors, not the whole tree", async () => {
  const fs = new FakeFs()
  fs.mkdir("/a", { recursive: true }); fs.mkdir("/b", { recursive: true })
  const N = 40
  for (let i = 0; i < N; i++) fs.writeFile(`/a/f${i}.txt`, `a${i}`)
  for (let i = 0; i < N; i++) fs.writeFile(`/b/f${i}.txt`, `b${i}`)

  let reads = 0
  const counting: FsLike = {
    stat: p => { const s = fs.stat(p); return { mode: s.mode, size: s.content.length, mtime: s.mtime } },
    readdir: d => fs.readdir(d),
    readFile: p => { reads++; return fs.readFile(p) },
  }
  let fire: (c: { path: string }) => void = () => {}
  const watcher: FsWatcher = h => { fire = h; return () => {} }

  const sent: ShadowOp[] = []
  const A = new Editor()
  const detach = attachAuthority(A, stubLink("authority", sent), {
    fs: counting, fsRoot: "/", watcher, cas: new MemCas(), flushMs: 0,
  })
  await settle() // seed buildManifest
  expect(reads).toBe(2 * N) // every file hashed once on seed

  reads = 0; sent.length = 0
  fs.writeFile("/a/f0.txt", "changed")
  fire({ path: "/a/f0.txt" })
  await settle()

  // Pre-fix: full buildManifest per event → reads === 2*N. Post-fix: just the leaf.
  expect(reads).toBe(1)
  const delta = sent.find(o => o.kind === "manifest-delta")
  expect(delta).toBeDefined()
  const paths = (delta as Extract<ShadowOp, { kind: "manifest-delta" }>).changes.map(c => c.path).sort()
  // leaf + each ancestor whose dirHash moved; siblings untouched
  expect(paths).toEqual(["/", "/a", "/a/f0.txt"])
  detach()
})

// ── 2893cfe0: sent[] is bounded across many splices with no rebase ──────────

test("ShadowState.sent is capped at MAX_SENT; eviction folds into baseBufSeq", () => {
  const sent: ShadowOp[] = []
  const S = new Editor()
  const buf = S.addBuffer(new BufferModel({ id: "b", name: "b", text: "" }))
  attachShadow(S, stubLink("shadow", sent), { cas: new MemCas() })
  const state = shadowState(S)!

  const extra = 50
  for (let i = 0; i < MAX_SENT + extra; i++) buf.insert("x")

  const list = state.sent.get("b")!
  // Pre-fix: list.length === MAX_SENT + extra (unbounded). Post-fix: capped.
  expect(list.length).toBe(MAX_SENT)
  // Evicted entries' bufSeq folded into baseBufSeq so rebase rewind still maps.
  expect(state.baseBufSeq.get("b")).toBe(extra)
  // Surviving entries are the most recent MAX_SENT, in order.
  expect(list[0]!.seq).toBe(extra + 1)
  expect(list[list.length - 1]!.seq).toBe(MAX_SENT + extra)
})
