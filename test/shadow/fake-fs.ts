/**
 * In-memory filesystem for the FS-replica DST sim (DESIGN.md §Filesystem replica).
 *
 * Path-keyed Map, posix-normalized, "/" root. Files and directories share the
 * map; directories carry mode S_IFDIR and empty content. Each path has a
 * monotone `version` bumped on every mutation so FakeWatcher can report
 * {path, kind, version} deltas without diffing snapshots — same role as
 * BufferModel.seq in the buffer-text sim.
 *
 * No symlinks, no permissions checks, no atomic rename — the sim only needs
 * the surface that A's manifest builder reads (stat/readdir/readFile) and that
 * genFsExt mutates (writeFile/unlink/mkdir).
 */

export const S_IFREG = 0o100000
export const S_IFDIR = 0o040000

export type Stat = { content: string; mtime: number; mode: number }
export type ChangeKind = "create" | "update" | "delete"
export interface FsChange { path: string; kind: ChangeKind; version: number }

type Entry = Stat & { version: number }

export function dirname(p: string): string {
  if (p === "/") return "/"
  const i = p.lastIndexOf("/")
  return i <= 0 ? "/" : p.slice(0, i)
}

export function basename(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1)
}

export class FakeFs {
  private entries = new Map<string, Entry>()
  /** Logical mtime clock — monotone so the sim never depends on Date.now(). */
  private clock = 1
  /** Global version counter; every mutation gets a fresh value. */
  private vclock = 0
  private listeners: Array<(c: FsChange) => void> = []

  constructor() {
    this.entries.set("/", { content: "", mtime: 0, mode: S_IFDIR | 0o755, version: 0 })
  }

  /** Register a mutation listener (FakeWatcher hooks here). */
  onChange(fn: (c: FsChange) => void): () => void {
    this.listeners.push(fn)
    return () => { const i = this.listeners.indexOf(fn); if (i >= 0) this.listeners.splice(i, 1) }
  }

  private emit(path: string, kind: ChangeKind, version: number): void {
    for (const l of this.listeners) l({ path, kind, version })
  }

  exists(path: string): boolean { return this.entries.has(path) }
  isDir(path: string): boolean { return ((this.entries.get(path)?.mode ?? 0) & S_IFDIR) !== 0 }

  stat(path: string): Stat {
    const e = this.entries.get(path)
    if (!e) throw new Error(`ENOENT: ${path}`)
    return { content: e.content, mtime: e.mtime, mode: e.mode }
  }

  version(path: string): number {
    return this.entries.get(path)?.version ?? 0
  }

  readFile(path: string): string {
    const e = this.entries.get(path)
    if (!e) throw new Error(`ENOENT: ${path}`)
    if (e.mode & S_IFDIR) throw new Error(`EISDIR: ${path}`)
    return e.content
  }

  /** Immediate children of `dir` (basenames). */
  readdir(dir: string): string[] {
    const e = this.entries.get(dir)
    if (!e || !(e.mode & S_IFDIR)) throw new Error(`ENOTDIR: ${dir}`)
    const prefix = dir === "/" ? "/" : dir + "/"
    const out: string[] = []
    for (const p of this.entries.keys()) {
      if (p === dir || !p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      if (!rest.includes("/")) out.push(rest)
    }
    return out.sort()
  }

  mkdir(path: string, opts: { recursive?: boolean } = {}): void {
    if (this.entries.has(path)) {
      if (this.isDir(path)) return
      throw new Error(`EEXIST: ${path}`)
    }
    const parent = dirname(path)
    if (!this.entries.has(parent)) {
      if (!opts.recursive) throw new Error(`ENOENT: ${parent}`)
      this.mkdir(parent, opts)
    }
    const v = ++this.vclock
    this.entries.set(path, { content: "", mtime: this.clock++, mode: S_IFDIR | 0o755, version: v })
    this.emit(path, "create", v)
  }

  writeFile(path: string, content: string, mode = S_IFREG | 0o644): void {
    const parent = dirname(path)
    if (!this.isDir(parent)) throw new Error(`ENOENT: ${parent}`)
    const prev = this.entries.get(path)
    if (prev && prev.mode & S_IFDIR) throw new Error(`EISDIR: ${path}`)
    const v = ++this.vclock
    this.entries.set(path, { content, mtime: this.clock++, mode: prev?.mode ?? mode, version: v })
    this.emit(path, prev ? "update" : "create", v)
  }

  unlink(path: string): void {
    const e = this.entries.get(path)
    if (!e) throw new Error(`ENOENT: ${path}`)
    if (e.mode & S_IFDIR && this.readdir(path).length) throw new Error(`ENOTEMPTY: ${path}`)
    const v = ++this.vclock
    this.entries.delete(path)
    this.emit(path, "delete", v)
  }

  /** All file (non-dir) paths, sorted — convenience for the sim's invariant check. */
  paths(): string[] {
    return [...this.entries.keys()].filter(p => !(this.entries.get(p)!.mode & S_IFDIR)).sort()
  }

  /** All directory paths, sorted. */
  dirs(): string[] {
    return [...this.entries.keys()].filter(p => (this.entries.get(p)!.mode & S_IFDIR) !== 0).sort()
  }
}
