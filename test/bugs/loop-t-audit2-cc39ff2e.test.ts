import { expect, test } from "bun:test"
import { ManifestCache, dirHash, diffManifest, buildManifest, type FsLike } from "../../src/shadow/manifest"
import type { ManifestEntry, ManifestTree } from "../../src/shadow/ops"
import { FakeFs, S_IFDIR, dirname } from "../shadow/fake-fs"

const file = (path: string, sha: string, mtime = 1, size = 1): ManifestEntry =>
  ({ path, sha, mode: 0o100644, size, mtime })
const dir = (path: string, sha: string): ManifestEntry =>
  ({ path, sha, mode: S_IFDIR | 0o755, size: 0, mtime: 1 })
const tree = (d: string, entries: ManifestEntry[]): ManifestTree =>
  ({ kind: "manifest-tree", root: "", dir: d, entries })

// ── t-audit2-cc39ff2e: subtree-delete leaks grandchild listings ────────────

test("applyDelta: deleting a dir evicts all cached descendant listings", () => {
  const c = new ManifestCache()
  // Load /, /a, /a/b, /a/b/c — three levels deep.
  c.applyTree(tree("/", [dir("/a", "ha")]))
  c.applyTree(tree("/a", [dir("/a/b", "hb")]))
  c.applyTree(tree("/a/b", [dir("/a/b/c", "hc"), file("/a/b/f.txt", "ff")]))
  c.applyTree(tree("/a/b/c", [file("/a/b/c/deep.txt", "dd")]))
  expect(c.has("/a/b/c")).toBe(true)

  // diffManifest emits parent-first removals; after /a's listing is dropped,
  // /a/b's parent lookup misses and the old code `continue`s — leaking /a/b
  // and /a/b/c forever.
  c.applyDelta({ kind: "manifest-delta", changes: [
    { path: "/a", old: "ha" },
    { path: "/a/b", old: "hb" },
    { path: "/a/b/f.txt", old: "ff" },
    { path: "/a/b/c", old: "hc" },
    { path: "/a/b/c/deep.txt", old: "dd" },
  ] })

  expect(c.has("/a")).toBe(false)
  expect(c.has("/a/b")).toBe(false)      // leaked before fix
  expect(c.has("/a/b/c")).toBe(false)    // leaked before fix
  // entries() must not yield anything under the deleted subtree.
  for (const e of c.entries()) expect(e.path.startsWith("/a/")).toBe(false)
  // After eviction the dirs are unknown again, so requestMissing fires.
  expect(c.requestMissing("/a/b")).toEqual({ kind: "manifest-req", dir: "/a/b" })
})

test("applyDelta: single top-level delete (watcher-style) still evicts whole subtree", () => {
  const c = new ManifestCache()
  c.applyTree(tree("/", [dir("/a", "ha")]))
  c.applyTree(tree("/a", [dir("/a/b", "hb")]))
  c.applyTree(tree("/a/b", [file("/a/b/x.txt", "xx")]))
  // Watcher may report only the top rmdir without enumerating descendants.
  c.applyDelta({ kind: "manifest-delta", changes: [{ path: "/a", old: "ha" }] })
  expect(c.has("/a")).toBe(false)
  expect(c.has("/a/b")).toBe(false)
  expect(c.lookup("/a/b/x.txt")).toBe("unknown")
})

// ── t-audit2-cc39ff2e: cap ─────────────────────────────────────────────────

test("ManifestCache enforces a directory-count cap", () => {
  const c = new ManifestCache(4)
  for (let i = 0; i < 10; i++) c.applyTree(tree(`/d${i}`, [file(`/d${i}/f`, `s${i}`)]))
  const loaded = Array.from({ length: 10 }, (_, i) => `/d${i}`).filter(d => c.has(d))
  expect(loaded.length).toBeLessThanOrEqual(4)
  // Most-recently-applied survives; oldest evicted.
  expect(c.has("/d9")).toBe(true)
  expect(c.has("/d0")).toBe(false)
})

// ── t-audit2-37235ab8: dirHash mtime/size (comparator fixed alongside) ─────

test("dirHash includes mtime/size so metadata-only changes propagate to dired", async () => {
  // Unit: changing only mtime must change the hash.
  const v1 = file("/d/f", "same-sha", 100, 5)
  const v2 = file("/d/f", "same-sha", 200, 5)
  expect(dirHash([v1])).not.toBe(dirHash([v2]))
  const s1 = file("/d/f", "same-sha", 100, 5)
  const s2 = file("/d/f", "same-sha", 100, 9)
  expect(dirHash([s1])).not.toBe(dirHash([s2]))

  // Integration: touch a file (mtime-only change) → diffManifest must emit it.
  const fs = new FakeFs()
  fs.mkdir("/p", { recursive: true })
  fs.writeFile("/p/f.txt", "body")
  const fsLike: FsLike = {
    stat: p => { const s = fs.stat(p); return { mode: s.mode, size: s.content.length, mtime: s.mtime } },
    readdir: d => fs.readdir(d),
    readFile: p => fs.readFile(p),
  }
  const m1 = await buildManifest(fsLike, "/")
  fs.writeFile("/p/f.txt", "body") // same content, new mtime
  const m2 = await buildManifest(fsLike, "/")
  const changed = new Set(diffManifest(m1, m2).changes.map(c => c.path))
  expect(changed.has("/p/f.txt")).toBe(true)
})
