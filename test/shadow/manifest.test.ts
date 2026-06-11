import { describe, expect, test } from "bun:test"
import {
  ManifestCache,
  buildManifest,
  diffManifest,
  dirHash,
  type FsLike,
  type Manifest,
} from "../../src/shadow/manifest"
import { MemCas, evictCas, sha256 } from "../../src/shadow/cas"
import type { ManifestEntry, ManifestTree } from "../../src/shadow/ops"
import { FakeFs, S_IFDIR, dirname } from "./fake-fs"

/** Adapt FakeFs (sync, content-in-stat) to the FsLike surface buildManifest reads. */
function fsLike(fs: FakeFs): FsLike {
  return {
    stat: p => { const s = fs.stat(p); return { mode: s.mode, size: s.content.length, mtime: s.mtime } },
    readdir: d => fs.readdir(d),
    readFile: p => fs.readFile(p),
  }
}

function seed(fs: FakeFs, tree: Record<string, string>): void {
  for (const [p, c] of Object.entries(tree)) {
    if (p.endsWith("/")) fs.mkdir(p.slice(0, -1), { recursive: true })
    else { fs.mkdir(dirname(p), { recursive: true }); fs.writeFile(p, c) }
  }
}

const byPath = (m: Manifest) => new Map(m.map(e => [e.path, e]))

// ── buildManifest ───────────────────────────────────────────────────────────

describe("buildManifest", () => {
  test("round-trip: every file present with sha256(content), output is path-sorted", async () => {
    const fs = new FakeFs()
    seed(fs, {
      "/src/a.ts": "export const a = 1\n",
      "/src/b.ts": "export const b = 2\n",
      "/lib/util.ts": "util",
      "/README.md": "# readme\n",
    })
    const m = await buildManifest(fsLike(fs), "/")
    const idx = byPath(m)

    for (const p of fs.paths()) {
      const e = idx.get(p)
      expect(e).toBeDefined()
      expect(e!.sha).toBe(sha256(fs.readFile(p)))
      expect(e!.size).toBe(fs.readFile(p).length)
    }
    // sorted
    const paths = m.map(e => e.path)
    expect(paths).toEqual([...paths].sort())
    // root entry present and is a dir
    expect(idx.get("/")!.mode & S_IFDIR).toBeTruthy()
  })

  test("dirHash is the Merkle hash: identical subtree contents+metadata ⇒ identical dir sha", async () => {
    const fs = new FakeFs()
    seed(fs, { "/x/f": "same", "/y/f": "same" })
    // dirHash now folds in mtime/size so a `touch` propagates to dired; FakeFs's
    // mtime is a monotone clock, so pin it for the structural-equality check.
    const flat = fsLike(fs)
    const fixed: FsLike = { ...flat, stat: p => ({ ...flat.stat(p), mtime: 0 }) }
    const m = byPath(await buildManifest(fixed, "/"))
    expect(m.get("/x")!.sha).toBe(m.get("/y")!.sha)
    expect(m.get("/x")!.sha).toBe(dirHash([m.get("/x/f")!]))
  })

  test("dirHash is order-independent", () => {
    const a: ManifestEntry = { path: "/d/a", sha: "aa", mode: 0o100644, size: 1, mtime: 1 }
    const b: ManifestEntry = { path: "/d/b", sha: "bb", mode: 0o100644, size: 1, mtime: 1 }
    expect(dirHash([a, b])).toBe(dirHash([b, a]))
  })
})

// ── diffManifest ────────────────────────────────────────────────────────────

describe("diffManifest", () => {
  test("identical manifests → empty delta", async () => {
    const fs = new FakeFs()
    seed(fs, { "/a/b/c.txt": "hello" })
    const m = await buildManifest(fsLike(fs), "/")
    expect(diffManifest(m, m).changes).toEqual([])
  })

  test("single leaf change in deep tree → O(depth) entries (Merkle prunes siblings)", async () => {
    // Build /d0/d1/.../d{depth-1}/leaf.txt with a sibling file at every level,
    // so a naive diff would emit O(depth × fanout) but Merkle emits O(depth).
    const depth = 12
    const fs = new FakeFs()
    let dir = ""
    for (let i = 0; i < depth; i++) {
      dir += `/d${i}`
      fs.mkdir(dir, { recursive: true })
      fs.writeFile(`${dir}/sibling${i}.txt`, `s${i}`)
    }
    const leaf = `${dir}/leaf.txt`
    fs.writeFile(leaf, "v1")
    const m1 = await buildManifest(fsLike(fs), "/")

    fs.writeFile(leaf, "v2")
    const m2 = await buildManifest(fsLike(fs), "/")

    const delta = diffManifest(m1, m2)
    const changed = new Set(delta.changes.map(c => c.path))
    // The leaf + each ancestor dir (root through d{depth-1}) — and nothing else.
    expect(changed.has(leaf)).toBe(true)
    expect(delta.changes.length).toBe(depth + 2) // leaf + depth dirs + root
    for (const c of delta.changes) {
      // No sibling appears.
      expect(c.path.includes("sibling")).toBe(false)
    }
    // The leaf change carries old sha and new entry.
    const leafChange = delta.changes.find(c => c.path === leaf)!
    expect(leafChange.old).toBe(sha256("v1"))
    expect(leafChange.new!.sha).toBe(sha256("v2"))
  })

  test("add and delete are emitted, with subtree expansion", async () => {
    const fs1 = new FakeFs(); seed(fs1, { "/keep.txt": "k", "/gone/a.txt": "a", "/gone/b.txt": "b" })
    const fs2 = new FakeFs(); seed(fs2, { "/keep.txt": "k", "/new/x.txt": "x" })
    const m1 = await buildManifest(fsLike(fs1), "/")
    const m2 = await buildManifest(fsLike(fs2), "/")
    const delta = diffManifest(m1, m2)
    const paths = new Map(delta.changes.map(c => [c.path, c]))

    expect(paths.get("/gone")!.new).toBeUndefined()
    expect(paths.get("/gone/a.txt")!.new).toBeUndefined()
    expect(paths.get("/new")!.old).toBeUndefined()
    expect(paths.get("/new/x.txt")!.new!.sha).toBe(sha256("x"))
    expect(paths.has("/keep.txt")).toBe(false) // unchanged → pruned
  })
})

// ── ManifestCache ───────────────────────────────────────────────────────────

describe("ManifestCache", () => {
  const entry = (path: string, sha: string): ManifestEntry =>
    ({ path, sha, mode: 0o100644, size: sha.length, mtime: 1 })
  const tree = (dir: string, entries: ManifestEntry[]): ManifestTree =>
    ({ kind: "manifest-tree", root: "", dir, entries })

  test("lookup: unknown until tree applied; then entry-or-null", () => {
    const c = new ManifestCache()
    expect(c.lookup("/src/a.ts")).toBe("unknown")
    expect(c.requestMissing("/src")).toEqual({ kind: "manifest-req", dir: "/src" })

    c.applyTree(tree("/src", [entry("/src/a.ts", "aaa"), entry("/src/b.ts", "bbb")]))
    expect(c.lookup("/src/a.ts")).toEqual(entry("/src/a.ts", "aaa"))
    expect(c.lookup("/src/nope.ts")).toBeNull()
    expect(c.requestMissing("/src")).toBeNull()
    // Unvisited sibling dir still unknown.
    expect(c.lookup("/lib/x.ts")).toBe("unknown")
  })

  test("applyDelta updates loaded dirs, ignores unloaded ones", () => {
    const c = new ManifestCache()
    c.applyTree(tree("/src", [entry("/src/a.ts", "aaa")]))

    c.applyDelta({ kind: "manifest-delta", changes: [
      { path: "/src/a.ts", old: "aaa", new: entry("/src/a.ts", "AAA") },
      { path: "/src/new.ts", new: entry("/src/new.ts", "nnn") },
      { path: "/lib/x.ts", new: entry("/lib/x.ts", "xxx") }, // /lib unloaded → dropped
    ] })

    expect((c.lookup("/src/a.ts") as ManifestEntry).sha).toBe("AAA")
    expect((c.lookup("/src/new.ts") as ManifestEntry).sha).toBe("nnn")
    expect(c.lookup("/lib/x.ts")).toBe("unknown")
  })

  test("applyDelta delete removes entry; deleting a loaded dir drops its listing", () => {
    const c = new ManifestCache()
    c.applyTree(tree("/", [entry("/a.txt", "aaa"), { path: "/sub", sha: "h", mode: S_IFDIR | 0o755, size: 0, mtime: 1 }]))
    c.applyTree(tree("/sub", [entry("/sub/x.txt", "xxx")]))

    c.applyDelta({ kind: "manifest-delta", changes: [{ path: "/a.txt", old: "aaa" }] })
    expect(c.lookup("/a.txt")).toBeNull()

    c.applyDelta({ kind: "manifest-delta", changes: [{ path: "/sub", old: "h" }] })
    expect(c.lookup("/sub/x.txt")).toBe("unknown")
  })

  test("applyTree replaces (heartbeat resync clears stale entries)", () => {
    const c = new ManifestCache()
    c.applyTree(tree("/src", [entry("/src/a.ts", "aaa"), entry("/src/b.ts", "bbb")]))
    c.applyTree(tree("/src", [entry("/src/a.ts", "AAA")])) // b.ts gone on A
    expect((c.lookup("/src/a.ts") as ManifestEntry).sha).toBe("AAA")
    expect(c.lookup("/src/b.ts")).toBeNull()
  })

  test("lazy-fetch flow: unknown → request → tree → known", () => {
    const c = new ManifestCache()
    const want = "/deep/nested/file.txt"
    // Walk down requesting each unloaded ancestor — what S does on find-file.
    const reqs: string[] = []
    let dir = dirname(want)
    while (c.lookup(want) === "unknown") {
      const r = c.requestMissing(dir)
      expect(r).not.toBeNull()
      reqs.push(r!.dir)
      // simulate A's reply
      c.applyTree(tree(dir, dir === dirname(want) ? [entry(want, "fff")] : []))
      dir = dirname(want) // only the leaf's parent matters for lookup
    }
    expect((c.lookup(want) as ManifestEntry).sha).toBe("fff")
    expect(reqs).toContain("/deep/nested")
  })
})

// ── evictCas ────────────────────────────────────────────────────────────────

describe("evictCas", () => {
  test("under cap → no-op", () => {
    const cas = new MemCas()
    cas.write("a"); cas.write("bb"); cas.write("ccc")
    expect(evictCas(cas, 100)).toBe(0)
    expect([...cas.entries()].length).toBe(3)
  })

  test("over cap → evicts oldest-atime to ≤0.8×max; recently-read survives", () => {
    const cas = new MemCas()
    const shas = ["aaaa", "bbbb", "cccc", "dddd", "eeee"].map(t => cas.write(t)) // 20 bytes
    cas.lookup(shas[0]!) // touch — now most recent
    const freed = evictCas(cas, 16) // target = 12
    expect(freed).toBeGreaterThanOrEqual(8)
    const left = [...cas.entries()]
    expect(left.reduce((n, e) => n + e.size, 0)).toBeLessThanOrEqual(12)
    // shas[0] was touched → survives; shas[1] (oldest untouched) → gone.
    expect(cas.lookup(shas[0]!)).toBe("aaaa")
    expect(cas.lookup(shas[1]!)).toBeUndefined()
  })
})
