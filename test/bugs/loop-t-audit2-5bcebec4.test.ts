/**
 * t-audit2-5bcebec4: IdbCas.lookupAsync atime-touch re-put the full blob,
 *   raced with delete (resurrecting it), and double-counted size.
 *
 * Fixed in the same commit as t-audit2-3c1ffb29 (v2 schema split + guarded
 * `touch`). That file already asserts "touch doesn't rewrite the blob row";
 * this file locks in the other two consequences:
 *   • the `if (m)` guard — touch never creates a meta row, so a delete that
 *     wins the race stays deleted;
 *   • repeated lookups don't inflate the `bytes` estimate into a spurious
 *     sweep.
 *
 * Uses the same minimal IndexedDB fake as 3c1ffb29 (Bun has no indexedDB and
 * fake-indexeddb isn't a dep).
 */
import { afterEach, beforeEach, expect, test } from "bun:test"
import { sha256 } from "../../src/shadow/cas"

// ── minimal IndexedDB fake (just the surface IdbCas touches) ────────────────

type Req<T = unknown> = {
  result: T; error: Error | null
  onsuccess: null | (() => void); onerror: null | (() => void)
}
function fire<T>(r: Req<T>, v: T) { queueMicrotask(() => { r.result = v; r.onsuccess?.() }) }
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
  onversionchange: null | (() => void) = null
  get objectStoreNames() { const s = this.stores; return { contains: (n: string) => s.has(n) } }
  createObjectStore(n: string, o: { keyPath: string }) {
    const st = new FakeStore(o.keyPath); this.stores.set(n, st); return st
  }
  deleteObjectStore(n: string) { this.stores.delete(n) }
  transaction(_n: string | string[], _m?: string) {
    const s = this.stores
    return { objectStore: (n: string) => s.get(n)! }
  }
  close() {}
}

const fakeIdb = {
  db: undefined as FakeDB | undefined,
  reset() { this.db = undefined },
  open(_name: string, _v: number) {
    const r = mkReq<FakeDB>() as Req<FakeDB> & {
      onupgradeneeded: null | (() => void); onblocked: null | (() => void)
    }
    r.onupgradeneeded = null; r.onblocked = null
    queueMicrotask(() => {
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

test("t-audit2-5bcebec4: touch is guarded — does not resurrect a meta row deleted mid-flight", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ onerror: () => {} })
  const sha = cas.write("payload")
  await flush()
  const meta = fakeIdb.db!.stores.get("meta")!
  // Simulate delete winning the race after lookupAsync has read the blob:
  // drop the meta row, leave the blob.
  meta.data.delete(sha)
  expect(await cas.lookupAsync(sha)).toBe("payload")
  await flush()
  // Old put-based touch would unconditionally write the row back. New touch's
  // get→if(m)→put guard sees no meta row and does nothing.
  expect(meta.data.has(sha)).toBe(false)
  expect((await cas.entriesAsync()).find((e: { sha: string }) => e.sha === sha)).toBeUndefined()
})

test("t-audit2-5bcebec4: repeated lookupAsync does not inflate bytes into a spurious sweep", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ maxBytes: 100, onerror: () => {} })
  const big = "x".repeat(60)
  const shaBig = cas.write(big)
  await flush()
  // If touch routed through put() and bytes-accounting, each lookup would add
  // another 60 → after two lookups bytes≈180 > cap → sweep evicts the entry.
  for (let i = 0; i < 5; i++) { expect(await cas.lookupAsync(shaBig)).toBe(big); await flush() }
  // Second write keeps real total at 90 ≤ 100: must not sweep.
  const shaSmall = cas.write("y".repeat(30))
  await flush()
  const entries = await cas.entriesAsync()
  const total = entries.reduce((n: number, e: { size: number }) => n + e.size, 0)
  expect(total).toBe(90)
  expect(await cas.lookupAsync(shaBig)).toBe(big)
  expect(await cas.lookupAsync(shaSmall)).toBe("y".repeat(30))
})

test("t-audit2-5bcebec4: re-writing an existing sha does not double-count bytes", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cas = new (IdbCas as any)({ maxBytes: 100, onerror: () => {} })
  const text = "z".repeat(60)
  cas.write(text); await flush()
  cas.write(text); await flush() // same sha → put() must see prev and not add 60 again
  const entries = await cas.entriesAsync()
  expect(entries.reduce((n: number, e: { size: number }) => n + e.size, 0)).toBe(60)
  // 60 ≤ 100 — entry survives (a double-count would read 120 → sweep).
  expect(await cas.lookupAsync(sha256(text))).toBe(text)
})
