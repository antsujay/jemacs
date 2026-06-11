/** t-audit2-37235ab8 — dirHash: comparator never returned 0; mtime/size excluded.
 *
 *  Old `(an < bn ? -1 : 1)` violated the comparator contract (cmp(x,x) ≠ 0) and
 *  the hash buf omitted mtime/size, so a `touch` (mtime-only change) produced an
 *  identical Merkle hash → diffManifest pruned the subtree → S's dired showed
 *  stale timestamps. Fixed in 20a92f9; see also loop-t-audit2-cc39ff2e. */
import { expect, test } from "bun:test"
import { dirHash, buildManifest, diffManifest, type FsLike } from "../../src/shadow/manifest"
import type { ManifestEntry } from "../../src/shadow/ops"
import { FakeFs } from "../shadow/fake-fs"

const f = (path: string, sha: string, mtime: number, size: number): ManifestEntry =>
  ({ path, sha, mode: 0o100644, size, mtime })

test("dirHash comparator is stable: input order does not affect the hash", () => {
  const a = f("/d/a", "ha", 1, 1)
  const b = f("/d/b", "hb", 1, 1)
  const c = f("/d/c", "hc", 1, 1)
  // Broken `-1 : 1` comparator is inconsistent (cmp(x,x)=1); result depended on
  // engine sort internals. Correct comparator ⇒ every permutation hashes equal.
  const ref = dirHash([a, b, c])
  expect(dirHash([c, b, a])).toBe(ref)
  expect(dirHash([b, a, c])).toBe(ref)
  expect(dirHash([a, c, b])).toBe(ref)
})

test("dirHash folds in mtime and size: metadata-only change ⇒ different hash", () => {
  const base = f("/d/f", "same-sha", 100, 5)
  expect(dirHash([f("/d/f", "same-sha", 200, 5)])).not.toBe(dirHash([base])) // mtime
  expect(dirHash([f("/d/f", "same-sha", 100, 9)])).not.toBe(dirHash([base])) // size
})

test("touch propagates through diffManifest so dired sees the new timestamp", async () => {
  const fs = new FakeFs()
  fs.mkdir("/p", { recursive: true })
  fs.writeFile("/p/f.txt", "body")
  const fsLike: FsLike = {
    stat: p => { const s = fs.stat(p); return { mode: s.mode, size: s.content.length, mtime: s.mtime } },
    readdir: d => fs.readdir(d),
    readFile: p => fs.readFile(p),
  }
  const before = await buildManifest(fsLike, "/")
  fs.writeFile("/p/f.txt", "body") // same bytes ⇒ same sha; only mtime advances
  const after = await buildManifest(fsLike, "/")
  const changed = new Set(diffManifest(before, after).changes.map(c => c.path))
  expect(changed.has("/p/f.txt")).toBe(true) // pruned to ∅ before fix
  expect(changed.has("/p")).toBe(true)       // ancestor dirHash bubbled
})
