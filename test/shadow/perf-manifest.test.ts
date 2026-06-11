import { describe, expect, test } from "bun:test"
import {
  ManifestCache,
  buildManifest,
  dirname,
  type FsLike,
  type Manifest,
  type ManifestEntry,
  type ManifestTree,
} from "../../src/shadow/manifest"

// t-dog-2d8dc2e0: porffor dogfood — opening a 57k-file repo over a shadow link
// stalled. This pins the budget: A's full Merkle walk in <2s on the in-memory
// fixture; S's cached lookup/readdir in O(1) regardless of tree size.

const S_IFDIR = 0o040000
const S_IFREG = 0o100644

// ── Synthetic 57k-file FsLike ───────────────────────────────────────────────
// FakeFs.readdir is O(total entries) per call — fine for the small DST trees,
// but with 57k entries × ~1k dirs that's ~50M prefix scans and we'd be timing
// the fixture, not buildManifest. So: precompute children.

type Shape = { top: number; mid: number; leaf: number }
/** 30 × 30 × 64 = 57 600 files, 931 dirs — porffor's order of magnitude. */
const PORFFOR: Shape = { top: 30, mid: 30, leaf: 64 }

function bigFs(shape: Shape): { fs: FsLike; nFiles: number; nDirs: number; deepFile: string; deepDir: string } {
  const stat = new Map<string, { mode: number; size: number; mtime: number }>()
  const kids = new Map<string, string[]>()
  const body = new Map<string, string>()

  const mkdir = (p: string) => { stat.set(p, { mode: S_IFDIR | 0o755, size: 0, mtime: 1 }); kids.set(p, []) }
  const link = (parent: string, name: string) => kids.get(parent)!.push(name)

  mkdir("/")
  for (let i = 0; i < shape.top; i++) {
    const d1 = `/d${i}`
    mkdir(d1); link("/", `d${i}`)
    for (let j = 0; j < shape.mid; j++) {
      const d2 = `${d1}/d${j}`
      mkdir(d2); link(d1, `d${j}`)
      for (let k = 0; k < shape.leaf; k++) {
        const p = `${d2}/f${k}.js`
        // Distinct content per file so sha256 can't be hoisted/cached.
        const c = `export const v = ${i * 1_000_000 + j * 1000 + k}\n`
        stat.set(p, { mode: S_IFREG, size: c.length, mtime: 1 })
        body.set(p, c)
        link(d2, `f${k}.js`)
      }
    }
  }

  const fs: FsLike = {
    stat: p => stat.get(p) ?? (() => { throw new Error(`ENOENT: ${p}`) })(),
    readdir: d => kids.get(d) ?? (() => { throw new Error(`ENOTDIR: ${d}`) })(),
    readFile: p => body.get(p) ?? (() => { throw new Error(`ENOENT: ${p}`) })(),
  }
  const nFiles = shape.top * shape.mid * shape.leaf
  const nDirs = 1 + shape.top + shape.top * shape.mid
  const deepDir = `/d${shape.top - 1}/d${shape.mid - 1}`
  return { fs, nFiles, nDirs, deepFile: `${deepDir}/f${shape.leaf - 1}.js`, deepDir }
}

const ms = (t0: number) => performance.now() - t0

/** Index the flat manifest by parent dir once, so slicing per-dir replies is O(children). */
function byParent(m: Manifest): (dir: string) => ManifestTree {
  const ix = new Map<string, ManifestEntry[]>()
  for (const e of m) {
    const d = dirname(e.path)
    if (d === e.path) continue
    let list = ix.get(d)
    if (!list) ix.set(d, list = [])
    list.push(e)
  }
  return dir => ({ kind: "manifest-tree", root: "", dir, entries: ix.get(dir) ?? [] })
}

// ── budgets ─────────────────────────────────────────────────────────────────
// MANIFEST_MS is the dogfood ceiling. INSTANT_MS is loose enough for CI jitter
// but three orders below MANIFEST_MS — an O(nFiles) regression in the cached
// path would blow through it.
const MANIFEST_MS = 2_000
const INSTANT_MS = 10

describe("shadow perf: 57k-file tree (porffor dogfood)", () => {
  test(
    "buildManifest walks 57k files in <2s; cached readdir/find-file are instant",
    async () => {
      const { fs, nFiles, nDirs, deepFile, deepDir } = bigFs(PORFFOR)
      expect(nFiles).toBeGreaterThanOrEqual(57_000)

      // ── A-side: full Merkle walk ────────────────────────────────────────
      const t0 = performance.now()
      const m = await buildManifest(fs, "/")
      const tBuild = ms(t0)
      // Sanity first — a broken walk that returns [] would otherwise "pass" the budget.
      expect(m.length).toBe(nFiles + nDirs)
      const root = m.find(e => e.path === "/")!
      expect(root.mode & S_IFDIR).toBeTruthy()
      expect(root.sha.length).toBe(64)
      expect(tBuild).toBeLessThan(MANIFEST_MS)

      const listing = byParent(m)

      // ── S-side: first readdir — ManifestCache.applyTree + has() ─────────
      const cache = new ManifestCache()
      const leafTree = listing(deepDir) // 64 entries — what A ships on ManifestReq
      const t1 = performance.now()
      cache.applyTree(leafTree)
      const loaded = cache.has(deepDir)
      const tReaddir = ms(t1)
      expect(loaded).toBe(true)
      expect(leafTree.entries.length).toBe(PORFFOR.leaf)
      expect(tReaddir).toBeLessThan(INSTANT_MS)

      // ── S-side: first find-file — lookup() against the cached listing ───
      const t2 = performance.now()
      const hit = cache.lookup(deepFile)
      const tFind = ms(t2)
      expect(hit).not.toBe("unknown")
      expect(hit).not.toBeNull()
      expect((hit as ManifestEntry).sha.length).toBe(64)
      expect(tFind).toBeLessThan(INSTANT_MS)

      // ── project-find-file scale check: load every dir, iterate entries() ─
      // Guards ManifestCache.entries() staying linear — used by project-find-file.
      for (let i = 0; i < PORFFOR.top; i++) {
        cache.applyTree(listing(`/d${i}`))
        for (let j = 0; j < PORFFOR.mid; j++) cache.applyTree(listing(`/d${i}/d${j}`))
      }
      const t3 = performance.now()
      let n = 0
      for (const _ of cache.entries()) n++
      const tScan = ms(t3)
      expect(n).toBeGreaterThanOrEqual(nFiles)
      // Linear scan of ~58k entries — not "instant", but well under the manifest budget.
      expect(tScan).toBeLessThan(MANIFEST_MS / 10)

      // eslint-disable-next-line no-console
      console.log(
        `    perf: build=${tBuild.toFixed(0)}ms ` +
        `readdir=${tReaddir.toFixed(3)}ms find=${tFind.toFixed(3)}ms ` +
        `scan(${n})=${tScan.toFixed(1)}ms`,
      )
    },
    15_000,
  )
})
