import { sha256 } from "./cas"
import type { ManifestDelta, ManifestEntry, ManifestReq, ManifestTree } from "./ops"

export type { ManifestEntry, ManifestDelta, ManifestReq, ManifestTree } from "./ops"

const S_IFDIR = 0o040000
const isDir = (mode: number) => (mode & S_IFDIR) !== 0

type Awaitable<T> = T | Promise<T>

/** The slice of a filesystem that `buildManifest` reads. FakeFs (sync) and a
 *  thin `node:fs/promises` adapter both fit. */
export interface FsLike {
  stat(path: string): Awaitable<{ mode: number; size: number; mtime: number }>
  readdir(dir: string): Awaitable<string[]>
  readFile(path: string): Awaitable<string>
}

/** Flat array of entries, sorted by `path`. Directory entries' `sha` is the
 *  Merkle `dirHash` of their immediate children, so equal `sha` ⇒ equal subtree. */
export type Manifest = ManifestEntry[]

// ── Path helpers (posix; manifest paths are always /-separated) ─────────────

export function dirname(p: string): string {
  if (p === "/") return "/"
  const i = p.lastIndexOf("/")
  return i <= 0 ? "/" : p.slice(0, i)
}

function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1)
}

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`
}

// ── dirHash ─────────────────────────────────────────────────────────────────

/** Merkle hash of a directory's immediate children. Git tree-object shape:
 *  hash over `mode SP name NUL sha LF` per child, sorted by name. Only
 *  name/sha/mode participate — mtime/size changes alone don't propagate. */
export function dirHash(children: readonly ManifestEntry[]): string {
  const sorted = [...children].sort((a, b) => (basename(a.path) < basename(b.path) ? -1 : 1))
  let buf = ""
  for (const c of sorted) buf += `${c.mode.toString(8)} ${basename(c.path)}\0${c.sha}\n`
  return sha256(buf)
}

// ── buildManifest ───────────────────────────────────────────────────────────

/** Walk `fs` from `root`, hashing files and Merkle-hashing directories
 *  bottom-up. Returns a flat path-sorted array; the entry for `root` itself is
 *  included (its `sha` is the root hash sent on connect). */
export async function buildManifest(fs: FsLike, root: string): Promise<Manifest> {
  const out: Manifest = []
  await walk(root)
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return out

  async function walk(path: string): Promise<ManifestEntry> {
    const st = await fs.stat(path)
    if (!isDir(st.mode)) {
      const sha = sha256(await fs.readFile(path))
      const entry: ManifestEntry = { path, sha, mode: st.mode, size: st.size, mtime: st.mtime }
      out.push(entry)
      return entry
    }
    const names = await fs.readdir(path)
    const children: ManifestEntry[] = []
    for (const name of names) children.push(await walk(join(path, name)))
    const entry: ManifestEntry = { path, sha: dirHash(children), mode: st.mode, size: 0, mtime: st.mtime }
    out.push(entry)
    return entry
  }
}

// ── diffManifest ────────────────────────────────────────────────────────────

type Indexed = {
  byPath: Map<string, ManifestEntry>
  /** dir → immediate-child paths */
  children: Map<string, string[]>
  root: string
}

function index(m: Manifest): Indexed {
  const byPath = new Map<string, ManifestEntry>()
  const children = new Map<string, string[]>()
  let root = "/"
  for (const e of m) {
    byPath.set(e.path, e)
    const d = dirname(e.path)
    if (d === e.path) { root = e.path; continue } // root's own parent is itself
    let kids = children.get(d)
    if (!kids) children.set(d, kids = [])
    kids.push(e.path)
  }
  return { byPath, children, root }
}

/** Top-down Merkle walk: descend only into directories whose `sha` differs, so
 *  a single changed leaf yields O(depth) entries — the leaf plus each ancestor
 *  whose dirHash moved. Siblings with unchanged dirHash are pruned entirely. */
export function diffManifest(oldM: Manifest, newM: Manifest): ManifestDelta {
  const a = index(oldM)
  const b = index(newM)
  const changes: ManifestDelta["changes"] = []

  const visit = (path: string): void => {
    const ea = a.byPath.get(path)
    const eb = b.byPath.get(path)
    if (ea && eb && ea.sha === eb.sha) return // identical subtree — prune
    if (ea && !eb) { emitRemoved(path); return }
    if (!ea && eb) { emitAdded(path); return }
    // both present, sha differs
    changes.push({ path, old: ea!.sha, new: eb! })
    if (!isDir(eb!.mode)) return
    // recurse into the union of children
    const union = new Set<string>([...(a.children.get(path) ?? []), ...(b.children.get(path) ?? [])])
    for (const child of union) visit(child)
  }

  const emitAdded = (path: string): void => {
    const e = b.byPath.get(path)!
    changes.push({ path, new: e })
    if (isDir(e.mode)) for (const c of b.children.get(path) ?? []) emitAdded(c)
  }
  const emitRemoved = (path: string): void => {
    const e = a.byPath.get(path)!
    changes.push({ path, old: e.sha })
    if (isDir(e.mode)) for (const c of a.children.get(path) ?? []) emitRemoved(c)
  }

  visit(b.root)
  return { kind: "manifest-delta", changes }
}

// ── ManifestCache (S-side) ──────────────────────────────────────────────────

/** Result of a cache lookup: entry if known-present, `null` if known-absent
 *  (the parent dir is loaded and the name isn't in it), `"unknown"` if the
 *  parent dir hasn't been fetched yet. */
export type Lookup = ManifestEntry | null | "unknown"

/**
 * S's lazy partial manifest. Holds only the directories S has visited (via
 * `applyTree`), kept fresh by watcher-driven `applyDelta`s. A `lookup` that
 * returns `"unknown"` is the cue to send `requestMissing(dir)` over the link.
 */
export class ManifestCache {
  /** dir → (basename → entry). Presence of a dir key means "S has this dir's
   *  full listing"; absence means unknown. */
  private dirs = new Map<string, Map<string, ManifestEntry>>()

  /** Look up `path`. See `Lookup` for the three-way result. */
  lookup(path: string): Lookup {
    const dir = dirname(path)
    const listing = this.dirs.get(dir)
    if (!listing) return "unknown"
    return listing.get(basename(path)) ?? null
  }

  /** Is this directory's listing loaded? */
  has(dir: string): boolean {
    return this.dirs.has(dir)
  }

  /** Iterate every cached entry (for invariant checks / project-find-file). */
  *entries(): IterableIterator<ManifestEntry> {
    for (const listing of this.dirs.values()) yield* listing.values()
  }

  /** Apply A's full listing for one directory — replaces any prior listing,
   *  so a heartbeat re-request also clears stale deletions. */
  applyTree(tree: ManifestTree): void {
    const listing = new Map<string, ManifestEntry>()
    for (const e of tree.entries) listing.set(basename(e.path), e)
    this.dirs.set(tree.dir, listing)
  }

  /** Apply A's incremental changes. Deltas for directories S hasn't fetched
   *  are dropped — S will get the fresh listing when it visits. */
  applyDelta(delta: ManifestDelta): void {
    for (const c of delta.changes) {
      const dir = dirname(c.path)
      const listing = this.dirs.get(dir)
      if (!listing) continue
      const name = basename(c.path)
      if (c.new) listing.set(name, c.new)
      else listing.delete(name)
      // If a known directory was itself deleted, drop its listing too.
      if (!c.new && this.dirs.has(c.path)) this.dirs.delete(c.path)
    }
  }

  /** Produce the request to fetch `dir`'s listing, or `null` if already loaded.
   *  Idempotent — re-requesting a loaded dir is harmless (heartbeat does it),
   *  but `null` lets callers skip the round-trip. */
  requestMissing(dir: string): ManifestReq | null {
    return this.dirs.has(dir) ? null : { kind: "manifest-req", dir }
  }
}
