import { expect, spyOn, test } from "bun:test"
import { MemCas, sha256 } from "../../src/shadow/cas"
import { ManifestCache } from "../../src/shadow/manifest"
import type { ManifestEntry, ShadowOp } from "../../src/shadow/ops"
import { createRemoteRuntime } from "../../src/shadow/remote-runtime"
import { FakeLink } from "../shadow/fake-link"

const S_IFREG = 0o100644
const entry = (path: string, text: string): ManifestEntry =>
  ({ path, sha: sha256(text), mode: S_IFREG, size: text.length, mtime: 1 })

// t-audit2-397e9a83: writeFileText patches the manifest optimistically before A
// acks. When A rejects the write (acks the seq but never applies it — so no
// watcher delta follows), S's manifest diverges from A's truth permanently.
test("writeFileText: optimistic manifest patch is rolled back when A rejects the write", async () => {
  const { sLink, aLink } = FakeLink.pair()
  const aRecv: ShadowOp[] = []
  // A rejects every command: ack the seq (cmd processed) but don't touch fs.
  aLink.on(op => {
    aRecv.push(op)
    if (op.kind === "command") aLink.send({ kind: "ack", upTo: op.seq })
  })
  const runtime = createRemoteRuntime(sLink, new ManifestCache(), new MemCas())
  sLink.on(op => runtime.onOp(op))

  // Seed S's manifest with A's authoritative listing for /.
  runtime.onOp({ kind: "manifest-tree", root: "", dir: "/", entries: [entry("/a.txt", "old")] })
  expect((runtime.manifest.lookup("/a.txt") as ManifestEntry).sha).toBe(sha256("old"))

  await runtime.writeFileText("/a.txt", "new content")
  // Optimistic: a stat immediately after the write sees the new sha.
  expect((runtime.manifest.lookup("/a.txt") as ManifestEntry).sha).toBe(sha256("new content"))

  // Drain both directions: A acks but sends no manifest-delta (write rejected).
  aLink.drain(); sLink.drain()
  expect(aRecv.filter(o => o.kind === "command").length).toBe(1)

  // S must converge back to A's truth — not stay stuck on the optimistic sha.
  const e = runtime.manifest.lookup("/a.txt") as ManifestEntry
  expect(e.sha).toBe(sha256("old"))
  expect(await runtime.readdir!("/")).toEqual(["a.txt"])
})

test("writeFileText: rejected create is rolled back out of readdir", async () => {
  const { sLink, aLink } = FakeLink.pair()
  aLink.on(op => { if (op.kind === "command") aLink.send({ kind: "ack", upTo: op.seq }) })
  const runtime = createRemoteRuntime(sLink, new ManifestCache(), new MemCas())
  sLink.on(op => runtime.onOp(op))
  runtime.onOp({ kind: "manifest-tree", root: "", dir: "/", entries: [entry("/a.txt", "a")] })

  await runtime.writeFileText("/new.txt", "x")
  expect(await runtime.readdir!("/")).toEqual(["a.txt", "new.txt"])
  aLink.drain(); sLink.drain()
  // A never created /new.txt → it must vanish from S's listing too.
  expect(runtime.manifest.lookup("/new.txt")).toBeNull()
  expect(await runtime.readdir!("/")).toEqual(["a.txt"])
})

test("writeFileText: accepted write is confirmed by A's watcher delta (no rollback)", async () => {
  const { sLink, aLink } = FakeLink.pair()
  // A accepts: applies write, watcher fires manifest-delta, then acks.
  aLink.on(op => {
    if (op.kind !== "command") return
    const [path, text] = op.args as [string, string]
    aLink.send({ kind: "manifest-delta", changes: [{ path, new: entry(path, text) }] })
    aLink.send({ kind: "ack", upTo: op.seq })
  })
  const runtime = createRemoteRuntime(sLink, new ManifestCache(), new MemCas())
  sLink.on(op => runtime.onOp(op))
  runtime.onOp({ kind: "manifest-tree", root: "", dir: "/", entries: [entry("/a.txt", "old")] })

  await runtime.writeFileText("/a.txt", "v2")
  aLink.drain(); sLink.drain()
  expect((runtime.manifest.lookup("/a.txt") as ManifestEntry).sha).toBe(sha256("v2"))
})

// t-audit2-574cb62d (merged): readdir iterates manifest.entries() — every
// cached entry across every loaded dir — and filters by dirname. Should be
// O(children of dir), independent of how many other dirs S has visited.
test("readdir is O(dir children), not O(total cached entries)", async () => {
  const { sLink } = FakeLink.pair()
  const manifest = new ManifestCache()
  const runtime = createRemoteRuntime(sLink, manifest, new MemCas())
  // Load /target plus 50 sibling dirs S happens to have visited.
  runtime.onOp({ kind: "manifest-tree", root: "", dir: "/target",
    entries: [entry("/target/a", "a"), entry("/target/b", "b")] })
  for (let d = 0; d < 50; d++) {
    const es: ManifestEntry[] = []
    for (let f = 0; f < 20; f++) es.push(entry(`/d${d}/f${f}`, `${d}.${f}`))
    runtime.onOp({ kind: "manifest-tree", root: "", dir: `/d${d}`, entries: es })
  }

  const spy = spyOn(manifest, "entries")
  expect(await runtime.readdir!("/target")).toEqual(["a", "b"])
  // The full-scan iterator must not be the readdir path.
  expect(spy).not.toHaveBeenCalled()
  spy.mockRestore()
})
