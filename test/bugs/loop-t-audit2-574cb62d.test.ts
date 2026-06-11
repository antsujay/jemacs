import { expect, test } from "bun:test"
import { MemCas } from "../../src/shadow/cas"
import { ManifestCache } from "../../src/shadow/manifest"
import type { ManifestEntry, ManifestTree, ShadowOp } from "../../src/shadow/ops"
import { createRemoteRuntime } from "../../src/shadow/remote-runtime"
import type { ShadowLink } from "../../src/shadow/link"

// t-audit2-574cb62d: RemoteRuntime.readdir was O(total cached entries) — it
// walked `manifest.entries()` filtering on dirname for every call. With many
// dirs loaded, each dired refresh paid for the whole cache. Fix: maintain a
// dir→children index alongside the manifest so readdir is O(|children|).

const S_IFREG = 0o100644
const file = (path: string): ManifestEntry =>
  ({ path, sha: "", mode: S_IFREG, size: 0, mtime: 0 })
const tree = (dir: string, names: string[]): ManifestTree =>
  ({ kind: "manifest-tree", root: "", dir, entries: names.map(n => file(`${dir}/${n}`)) })

const nullLink: ShadowLink = {
  peerId: "A", role: "shadow", trust: "full",
  send: () => {}, on: () => {}, close: () => {},
}

test("readdir does not scan manifest.entries() — O(children), not O(cache)", async () => {
  const manifest = new ManifestCache()
  const rt = createRemoteRuntime(nullLink, manifest, new MemCas())

  // Load N sibling dirs × K files each via the normal inbound-op path.
  const N = 50, K = 4
  for (let i = 0; i < N; i++)
    rt.onOp(tree(`/d${i}`, Array.from({ length: K }, (_, j) => `f${j}`)))

  // Instrument entries() to count both calls and yielded rows.
  let calls = 0, yielded = 0
  const orig = manifest.entries.bind(manifest)
  manifest.entries = function* () { calls++; for (const e of orig()) { yielded++; yield e } }

  expect(await rt.readdir("/d0")).toEqual(["f0", "f1", "f2", "f3"])

  // Old impl: calls=1, yielded=N*K. New impl: never touches entries().
  expect(calls).toBe(0)
  expect(yielded).toBe(0)
})

test("readdir stays correct under deltas without rescanning the cache", async () => {
  const manifest = new ManifestCache()
  const rt = createRemoteRuntime(nullLink, manifest, new MemCas())

  rt.onOp(tree("/p", ["a", "b"]))
  rt.onOp(tree("/q", ["x"])) // unrelated dir — must not leak into /p's listing

  let yielded = 0
  const orig = manifest.entries.bind(manifest)
  manifest.entries = function* () { for (const e of orig()) { yielded++; yield e } }

  rt.onOp({ kind: "manifest-delta", changes: [{ path: "/p/c", new: file("/p/c") }, { path: "/p/a" }] } satisfies ShadowOp)
  expect(await rt.readdir("/p")).toEqual(["b", "c"])
  expect(yielded).toBe(0)
})
