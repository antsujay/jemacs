/**
 * t-qa-8cec2269: web --shadow — find-file/dired cwd is `/`.
 *
 * `createRemoteRuntime` is constructed without `opts.root` (shadow-entry has no
 * way to know A's project root at mount time), so `cwd()` returns "/". A
 * already knows the root (`createAuthorityFs(..., root)`); it should ship it in
 * `ManifestTree.root` and S should latch it as the runtime's cwd.
 */
import { expect, test } from "bun:test"
import { MemCas } from "../../src/shadow/cas"
import { type FsLike, ManifestCache } from "../../src/shadow/manifest"
import type { ManifestTree, ShadowOp } from "../../src/shadow/ops"
import { createAuthorityFs, createRemoteRuntime } from "../../src/shadow/remote-runtime"
import { FakeLink } from "../shadow/fake-link"

const fs: FsLike = {
  stat: () => ({ mode: 0o100644, size: 0, mtime: 0 }),
  readdir: () => [],
  readFile: () => "",
}

async function settle(a: FakeLink, s: FakeLink): Promise<void> {
  for (let idle = 0; idle < 2; ) {
    const n = a.drain() + s.drain()
    await new Promise(r => setTimeout(r, 0))
    idle = n === 0 && a.inflight.length === 0 && s.inflight.length === 0 ? idle + 1 : 0
  }
}

test("A: manifest-tree carries fsRoot in `root` (both jailed-reject and listDir)", async () => {
  const { sLink, aLink } = FakeLink.pair()
  const sent: ShadowOp[] = []
  sLink.on(op => sent.push(op))
  const afs = createAuthorityFs(aLink, fs, "/home/user/proj")
  aLink.on(op => afs.onOp(op))

  // `/` is outside the jail → rejected with empty entries; must still carry fsRoot.
  sLink.send({ kind: "manifest-req", dir: "/" })
  // The project root itself → real listing; must carry fsRoot.
  sLink.send({ kind: "manifest-req", dir: "/home/user/proj" })
  await settle(sLink, aLink)

  const trees = sent.filter((o): o is ManifestTree => o.kind === "manifest-tree")
  expect(trees.length).toBe(2)
  for (const t of trees) expect(t.root).toBe("/home/user/proj")
})

test("S: cwd() latches fsRoot from the first manifest-tree", () => {
  const { sLink } = FakeLink.pair()
  const runtime = createRemoteRuntime(sLink, new ManifestCache(), new MemCas())
  expect(runtime.cwd()).toBe("/") // not yet known

  runtime.onOp({ kind: "manifest-tree", root: "/home/user/proj", dir: "/", entries: [] })
  expect(runtime.cwd()).toBe("/home/user/proj")
  expect(runtime.homedir()).toBe("/home/user/proj")

  // Explicit opts.root wins over the wire value (caller pinned it).
  const pinned = createRemoteRuntime(sLink, new ManifestCache(), new MemCas(), { root: "/pinned" })
  pinned.onOp({ kind: "manifest-tree", root: "/elsewhere", dir: "/", entries: [] })
  expect(pinned.cwd()).toBe("/pinned")
})

test("S: end-to-end — readdir(cwd) round-trip latches fsRoot", async () => {
  const { sLink, aLink } = FakeLink.pair()
  const afs = createAuthorityFs(aLink, fs, "/home/user/proj")
  aLink.on(op => afs.onOp(op))
  const runtime = createRemoteRuntime(sLink, new ManifestCache(), new MemCas())
  sLink.on(op => runtime.onOp(op))

  // shadow-entry's eager seed: ask for cwd() (still "/") so A's reply teaches us fsRoot.
  const p = runtime.readdir(runtime.cwd())
  await settle(sLink, aLink)
  await p
  expect(runtime.cwd()).toBe("/home/user/proj")
})
