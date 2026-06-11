/**
 * t-audit2-3c1ffb29: IdbCas — open() memoizes a rejection forever; lookupAsync
 *   throws while write() silently swallows.
 * merged t-audit2-1aa00ad0 (p1): no eviction → unbounded IndexedDB growth.
 * merged t-audit2-be254871 (p1): no onblocked/onversionchange — schema bump
 *   deadlocks open() across tabs.
 * merged t-audit2-5bcebec4 (p2): lookupAsync atime-touch re-puts the full blob,
 *   races with delete, miscounts size.
 *
 * Bun has no IndexedDB and fake-indexeddb isn't a dep, so this file ships a
 * minimal fake that supports exactly the surface IdbCas touches plus failure
 * injection for the open() retry test.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { sha256 } from "../../src/shadow/cas"

// ── minimal IndexedDB fake ──────────────────────────────────────────────────

type Req<T = unknown> = {
  result: T; error: Error | null
  onsuccess: null | (() => void); onerror: null | (() => void)
}
function fire<T>(r: Req<T>, v: T) { queueMicrotask(() => { r.result = v; r.onsuccess?.() }) }
function fail<T>(r: Req<T>, e: Error) { queueMicrotask(() => { r.error = e; r.onerror?.() }) }
function mkReq<T>(): Req<T> { return { result: undefined as T, error: null, onsuccess: null, onerror: null } }

class FakeStore {
  readonly data = new Map<string, Record<string, unknown>>()
  puts = 0
  constructor(readonly keyPath: string) {}
  get(k: string) { const r = mkReq(); fire(r, this.data.get(k)); return r }
  put(v: Record<string, unknown>) {
    this.puts++; this.data.set(String(v[this.keyPath]), v)
    const r = mkReq(); fire(r, undefined); return r
  }
  delete(k: string) { this.data.delete(k); const r = mkReq(); fire(r, undefined); return r }
  openCursor() {
    const vals = [...this.data.values()]; let i = 0
    const r = mkReq<unknown>()
    const step = () => fire(r, i < vals.length ? { value: vals[i++], continue: step } : null)
    step()
    return r
  }
}

class FakeDB {
  readonly stores = new Map<string, FakeStore>()
  closed = false
  onversionchange: null | (() => void) = null
  get objectStoreNames() {
    const s = this.stores
    return { contains: (n: string) => s.has(n) }
  }
  createObjectStore(n: string, o: { keyPath: string }) {
    const st = new FakeStore(o.keyPath); this.stores.set(n, st); return st
  }
  deleteObjectStore(n: string) { this.stores.delete(n) }
  transaction(_names: string | string[], _mode?: string) {
    const s = this.stores
    return { objectStore: (n: string) => s.get(n)! }
  }
  close() { this.closed = true }
}

const fakeIdb = {
  db: undefined as FakeDB | undefined,
  failOpens: 0,
  reset() { this.db = undefined; this.failOpens = 0 },
  open(_name: string, _version: number) {
    const r = mkReq<FakeDB>() as Req<FakeDB> & {
      onupgradeneeded: null | (() => void); onblocked: null | (() => void)
    }
    r.onupgradeneeded = null; r.onblocked = null
    queueMicrotask(() => {
      if (this.failOpens > 0) { this.failOpens--; fail(r, new Error("idb open failed")); return }
      const fresh = this.db === undefined
      if (fresh) this.db = new FakeDB()
      r.result = this.db!
      if (fresh) r.onupgradeneeded?.()
      r.onsuccess?.()
    })
    return r
  },
}

/** Drain enough microtask rounds for nested open→txn→req→sweep chains. */
async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve() }

// ── harness ────────────────────────────────────────────────────────────────

let savedIdb: unknown
let IdbCas: typeof import("../../src/web/idb-cas").IdbCas

beforeEach(async () => {
  savedIdb = (globalThis as Record<string, unknown>).indexedDB
  ;(globalThis as Record<string, unknown>).indexedDB = fakeIdb
  fakeIdb.reset()
  ;({ IdbCas } = await import("../../src/web/idb-cas"))
})
afterEach(() => {
  ;(globalThis as Record<string, unknown>).indexedDB = savedIdb
})

// ── tests ──────────────────────────────────────────────────────────────────

test("t-audit2-3c1ffb29: transient open() failure is not memoized; lookupAsync degrades to miss", async () => {
  fakeIdb.failOpens = 1
  // Old: no try/catch → this await throws. New: returns undefined.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ onerror: () => {} })
  expect(await cas.lookupAsync("0".repeat(64))).toBeUndefined()
  // failOpens is now 0. Old: rejected promise is cached → next open() still
  // rejects → write's put swallows → lookup misses forever. New: dbp was
  // cleared on rejection → reopen succeeds.
  const sha = cas.write("hi")
  expect(sha).toBe(sha256("hi"))
  await flush()
  expect(await cas.lookupAsync(sha)).toBe("hi")
})

test("t-audit2-be254871: onversionchange closes the db and drops the cached handle", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ onerror: () => {} })
  cas.write("x"); await flush()
  const db1 = fakeIdb.db!
  // Old: never registered → typeof null === "object".
  expect(typeof db1.onversionchange).toBe("function")
  db1.onversionchange?.()
  expect(db1.closed).toBe(true)
  // Cached handle must have been dropped: next op opens a fresh connection.
  fakeIdb.db = undefined
  cas.write("y"); await flush()
  expect(fakeIdb.db).toBeDefined()
  expect(fakeIdb.db).not.toBe(db1)
})

test("t-audit2-5bcebec4: atime touch does not rewrite the blob payload", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ onerror: () => {} })
  const sha = cas.write("p".repeat(1000))
  await flush()
  const blobs = fakeIdb.db!.stores.get("blobs")!
  const before = blobs.puts
  expect(await cas.lookupAsync(sha)).toBe("p".repeat(1000))
  await flush()
  // Old: `void this.put({...entry, atime})` re-puts the full {sha,text} row.
  // New: touch writes only the small meta row; blobs is untouched.
  expect(blobs.puts).toBe(before)
})

test("t-audit2-1aa00ad0: maxBytes cap triggers an LRU sweep", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ maxBytes: 30, onerror: () => {} })
  cas.write("a".repeat(20)); await flush()
  cas.write("b".repeat(20)); await flush() // 40 > 30 → should auto-sweep
  await flush()
  const total = (await cas.entriesAsync()).reduce((n: number, e: { size: number }) => n + e.size, 0)
  // Old: no cap, no sweep — total stays 40.
  expect(total).toBeLessThanOrEqual(30)
  // The newer entry survives.
  expect(await cas.lookupAsync(sha256("b".repeat(20)))).toBe("b".repeat(20))
})
