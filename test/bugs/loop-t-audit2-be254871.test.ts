/**
 * t-audit2-be254871: IdbCas.open() had no `onblocked`/`onversionchange` — a
 *   schema bump with another tab open made the IDBOpenDBRequest hang forever
 *   (no event fires that we listen for), wedging every subsequent CAS op.
 * merged t-audit2-5bcebec4: lookupAsync's atime-touch re-`put` the full row,
 *   so a touch racing a delete could resurrect the entry and double-count bytes.
 *
 * The fix + the onversionchange / blob-rewrite halves are already covered in
 * loop-t-audit2-3c1ffb29.test.ts (this task was merged there); this file adds
 * the two halves that weren't: `onblocked` rejects, and touch's `if (m)` guard.
 */
import { afterEach, beforeEach, expect, test } from "bun:test"

// ── minimal IndexedDB fake (just the surface IdbCas touches) ────────────────

type Req<T = unknown> = {
  result: T; error: Error | null
  onsuccess: null | (() => void); onerror: null | (() => void)
}
const mkReq = <T>(): Req<T> => ({ result: undefined as T, error: null, onsuccess: null, onerror: null })
const fire = <T>(r: Req<T>, v: T) => queueMicrotask(() => { r.result = v; r.onsuccess?.() })

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
    step(); return r
  }
}

class FakeDB {
  readonly stores = new Map<string, FakeStore>()
  closed = false
  onversionchange: null | (() => void) = null
  get objectStoreNames() { const s = this.stores; return { contains: (n: string) => s.has(n) } }
  createObjectStore(n: string, o: { keyPath: string }) {
    const st = new FakeStore(o.keyPath); this.stores.set(n, st); return st
  }
  deleteObjectStore(n: string) { this.stores.delete(n) }
  transaction(_n: string | string[], _m?: string) {
    const s = this.stores; return { objectStore: (n: string) => s.get(n)! }
  }
  close() { this.closed = true }
}

const fakeIdb = {
  db: undefined as FakeDB | undefined,
  blockOpens: 0,
  reset() { this.db = undefined; this.blockOpens = 0 },
  open(_name: string, _version: number) {
    const r = mkReq<FakeDB>() as Req<FakeDB> & {
      onupgradeneeded: null | (() => void); onblocked: null | (() => void)
    }
    r.onupgradeneeded = null; r.onblocked = null
    queueMicrotask(() => {
      if (this.blockOpens > 0) {
        this.blockOpens--
        // Real IDB fires `blocked` and then *nothing* until the other tab
        // closes. Old IdbCas registered no handler → the open() promise never
        // settled. Now: onblocked rejects.
        r.onblocked?.()
        return
      }
      const fresh = this.db === undefined
      if (fresh) this.db = new FakeDB()
      r.result = this.db!
      if (fresh) r.onupgradeneeded?.()
      r.onsuccess?.()
    })
    return r
  },
}

async function flush() { for (let i = 0; i < 25; i++) await Promise.resolve() }

let savedIdb: unknown
let IdbCas: typeof import("../../src/web/idb-cas").IdbCas

beforeEach(async () => {
  savedIdb = (globalThis as Record<string, unknown>).indexedDB
  ;(globalThis as Record<string, unknown>).indexedDB = fakeIdb
  fakeIdb.reset()
  ;({ IdbCas } = await import("../../src/web/idb-cas"))
})
afterEach(() => { (globalThis as Record<string, unknown>).indexedDB = savedIdb })

// ── t-audit2-be254871 ───────────────────────────────────────────────────────

test("t-audit2-be254871: onblocked rejects open() instead of hanging; retry succeeds", async () => {
  fakeIdb.blockOpens = 1
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ onerror: () => {} })
  // Old: open() promise never settles → this await never resolves. Guard with a
  // race so the test fails fast instead of timing out.
  const TIMEOUT = Symbol("timeout")
  const got = await Promise.race([
    cas.lookupAsync("0".repeat(64)),
    new Promise(res => setTimeout(() => res(TIMEOUT), 200)),
  ])
  expect(got).not.toBe(TIMEOUT)       // settled — onblocked fired the reject
  expect(got).toBeUndefined()         // and lookupAsync degrades the error to a miss
  // The rejected open must not be memoized: blockOpens is now 0, so a retry
  // reopens and round-trips.
  const sha = cas.write("hi"); await flush()
  expect(await cas.lookupAsync(sha)).toBe("hi")
})

// ── t-audit2-5bcebec4 ───────────────────────────────────────────────────────

test("t-audit2-5bcebec4: touch is guarded — does not resurrect a meta row deleted out from under it", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ onerror: () => {} })
  const sha = cas.write("payload"); await flush()
  const meta = fakeIdb.db!.stores.get("meta")!
  // Simulate a concurrent delete winning the race before touch's get runs.
  meta.data.delete(sha)
  const before = meta.puts
  expect(await cas.lookupAsync(sha)).toBe("payload")
  await flush()
  // Old: unconditional put({sha,text,atime}) — row comes back. New: `if (m)`
  // guard sees META miss and skips the put entirely.
  expect(meta.data.has(sha)).toBe(false)
  expect(meta.puts).toBe(before)
})
