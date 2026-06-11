/// <reference lib="dom" />
/**
 * IndexedDB-backed `Cas` for the browser shadow. Persists buffer/file content
 * across page reloads so a reconnecting S can answer `BufferRef` with `Have`
 * instead of re-streaming everything (DESIGN.md §Content-addressed).
 *
 * IndexedDB has no sync read path, so `lookup` is a constant miss and the real
 * work happens in `lookupAsync`. `write` computes the sha synchronously
 * (crypto-shim's `createHash`) and fire-and-forgets the `put` — every caller
 * only needs the sha back, not durability.
 *
 * Schema v2 splits each entry across two stores so an LRU atime-touch writes a
 * tiny meta row instead of rewriting the blob:
 *   blobs: { sha, text }
 *   meta:  { sha, atime, size }
 */

import type { Cas } from "../shadow/cas"
import { sha256 } from "../shadow/cas"

type BlobRow = { sha: string; text: string }
type MetaRow = { sha: string; atime: number; size: number }

const DB_NAME = "jemacs-cas"
const STORE = "blobs"
const META = "meta"
const VERSION = 2
/** Well under typical origin quota; bounds the worst-case re-stream on eviction. */
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error ?? new Error("IndexedDB request failed"))
  })
}

export interface IdbCasOptions {
  maxBytes?: number
  /** Surfaces fire-and-forget failures (write/touch/sweep). Defaults to
   *  `console.warn` so quota exhaustion or corruption isn't silent. */
  onerror?: (err: unknown) => void
}

export class IdbCas implements Cas {
  private dbp: Promise<IDBDatabase> | undefined
  /** Approximate live bytes; seeded from META on first write, then maintained
   *  incrementally. `sweep` recomputes, so drift is bounded. */
  private bytes: number | undefined
  private sweeping = false
  private readonly maxBytes: number
  private readonly onerror: (err: unknown) => void

  constructor(opts: IdbCasOptions = {}) {
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
    this.onerror = opts.onerror ?? (e => console.warn("IdbCas:", e))
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbp) return this.dbp
    const p = new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, VERSION)
      r.onupgradeneeded = () => {
        const db = r.result
        // v1 had {sha,text,atime} in one store. The cache is rebuildable, so
        // drop it rather than carry mixed-shape rows into v2.
        const hadV1 = db.objectStoreNames.contains(STORE) && !db.objectStoreNames.contains(META)
        if (hadV1) db.deleteObjectStore(STORE)
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "sha" })
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "sha" })
      }
      // Another tab still holds the old version open. Reject — the catch below
      // clears the memo so the next call retries instead of wedging forever.
      r.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another connection"))
      r.onsuccess = () => {
        const db = r.result
        // A newer tab wants to upgrade: yield the connection and drop our
        // cached handle so the next op reopens at the new version.
        db.onversionchange = () => {
          db.close()
          if (this.dbp === p) this.dbp = undefined
        }
        resolve(db)
      }
      r.onerror = () => reject(r.error ?? new Error("IndexedDB open failed"))
    })
    this.dbp = p
    // Never memoize a rejection — a transient failure (private mode, blocked
    // upgrade, quota race) must not poison every subsequent call.
    p.catch(() => { if (this.dbp === p) this.dbp = undefined })
    return p
  }

  /** Sync lookup is always a miss — callers use `lookupAsync`. */
  lookup(_sha: string): string | undefined {
    return undefined
  }

  async lookupAsync(sha: string): Promise<string | undefined> {
    try {
      const db = await this.open()
      const row = (await req(db.transaction(STORE).objectStore(STORE).get(sha))) as BlobRow | undefined
      if (row === undefined) return undefined
      void this.touch(db, sha).catch(e => this.onerror(e))
      return row.text
    } catch (e) {
      // Same degradation as `write`: a miss falls through to Want.
      this.onerror(e)
      return undefined
    }
  }

  /** Bump atime in META only. Guarded get→put inside one readwrite txn so a
   *  concurrent `delete` isn't resurrected and `bytes` isn't double-counted. */
  private async touch(db: IDBDatabase, sha: string): Promise<void> {
    const store = db.transaction(META, "readwrite").objectStore(META)
    const m = (await req(store.get(sha))) as MetaRow | undefined
    if (m) await req(store.put({ sha, atime: Date.now(), size: m.size }))
  }

  write(text: string): string {
    const sha = sha256(text)
    void this.put(sha, text).catch(e => this.onerror(e))
    return sha
  }

  private async put(sha: string, text: string): Promise<void> {
    const db = await this.open()
    if (this.bytes === undefined) {
      const all = await this.entriesAsync()
      this.bytes = all.reduce((n, e) => n + e.size, 0)
    }
    const tx = db.transaction([STORE, META], "readwrite")
    const meta = tx.objectStore(META)
    const prev = (await req(meta.get(sha))) as MetaRow | undefined
    await req(tx.objectStore(STORE).put({ sha, text }))
    await req(meta.put({ sha, atime: Date.now(), size: text.length }))
    if (!prev) {
      this.bytes += text.length
      if (this.bytes > this.maxBytes) void this.sweep().catch(e => this.onerror(e))
    }
  }

  /** LRU sweep down to 0.8×cap (same hysteresis as `evictCas`). Public so the
   *  host can also schedule it on `visibilitychange` / idle. */
  async sweep(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      const all = await this.entriesAsync()
      let total = all.reduce((n, e) => n + e.size, 0)
      this.bytes = total
      if (total <= this.maxBytes) return
      all.sort((a, b) => a.atime - b.atime)
      const target = Math.floor(this.maxBytes * 0.8)
      for (const e of all) {
        if (total <= target) break
        await this.delete(e.sha)
        total -= e.size
      }
      this.bytes = total
    } catch (e) {
      this.onerror(e)
    } finally {
      this.sweeping = false
    }
  }

  /** Snapshot of {sha,size,atime} from META — small rows, no blob payload. */
  async entriesAsync(): Promise<Array<{ sha: string; size: number; atime: number }>> {
    const db = await this.open()
    const store = db.transaction(META).objectStore(META)
    const out: Array<{ sha: string; size: number; atime: number }> = []
    return new Promise((resolve, reject) => {
      const r = store.openCursor()
      r.onsuccess = () => {
        const c = r.result
        if (!c) return resolve(out)
        const m = c.value as MetaRow
        out.push({ sha: m.sha, size: m.size, atime: m.atime })
        c.continue()
      }
      r.onerror = () => reject(r.error ?? new Error("IndexedDB cursor failed"))
    })
  }

  async delete(sha: string): Promise<void> {
    const db = await this.open()
    const tx = db.transaction([STORE, META], "readwrite")
    const m = (await req(tx.objectStore(META).get(sha))) as MetaRow | undefined
    await req(tx.objectStore(STORE).delete(sha))
    await req(tx.objectStore(META).delete(sha))
    if (m && this.bytes !== undefined) this.bytes = Math.max(0, this.bytes - m.size)
  }
}
