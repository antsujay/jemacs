import { describe, expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { announceBuffer, attachAuthority, attachShadow, shadowState } from "../../src/shadow/shadow"
import { MemCas, chunkText, diffText, sha256 } from "../../src/shadow/cas"
import type { ShadowOp } from "../../src/shadow/ops"
import { FakeLink } from "./fake-link"

// ── Unit: sha256 / diffText / chunkText ─────────────────────────────────────

describe("cas primitives", () => {
  test("sha256 is stable and matches known vector", () => {
    expect(sha256("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824")
    expect(sha256("")).toBe(sha256(""))
    expect(sha256("a")).not.toBe(sha256("b"))
  })

  test("MemCas round-trips by sha", () => {
    const cas = new MemCas()
    const sha = cas.write("hello world")
    expect(sha).toBe(sha256("hello world"))
    expect(cas.lookup(sha)).toBe("hello world")
    expect(cas.lookup(sha256("nope"))).toBeUndefined()
  })

  test("diffText: applying the splices to `from` yields `to`", () => {
    const cases: Array<[string, string]> = [
      ["", "hello"],
      ["hello", ""],
      ["hello", "hello"],
      ["a\nb\nc\n", "a\nB\nc\n"],
      ["line1\nline2\nline3\n", "line1\nline3\n"],
      ["line1\nline3\n", "line1\nline2\nline3\n"],
      ["a\nb\nc\nd\n", "a\nX\nc\nY\n"], // two distant edits → two splices
      ["no trailing newline", "no trailing newline!"],
      ["x", "completely different text"],
    ]
    for (const [from, to] of cases) {
      let cur = from
      for (const s of diffText(from, to, "b")) {
        cur = cur.slice(0, s.from) + s.text + cur.slice(s.to)
      }
      expect(cur).toBe(to)
    }
    // The two-distant-edits case must not degrade to one giant middle replace.
    expect(diffText("a\nb\nc\nd\n", "a\nX\nc\nY\n", "b").length).toBe(2)
  })

  test("chunkText splits at size and marks eof on the last chunk only", () => {
    const cs = chunkText("b", "abcdefghij", 4)
    expect(cs.map(c => c.data)).toEqual(["abcd", "efgh", "ij"])
    expect(cs.map(c => c.offset)).toEqual([0, 4, 8])
    expect(cs.map(c => !!c.eof)).toEqual([false, false, true])
    expect(chunkText("b", "")).toEqual([{ kind: "chunk", id: "b", offset: 0, data: "", eof: true }])
  })
})

// ── Integration: BufferRef → Have/Want → ack/rebase/chunk ───────────────────

/** A↔S pair over FakeLink with per-side MemCas and a tap on each direction. */
function rig() {
  const A = new Editor()
  const S = new Editor()
  const aCas = new MemCas()
  const sCas = new MemCas()
  const { sLink, aLink } = FakeLink.pair()
  const toS: ShadowOp[] = []
  const toA: ShadowOp[] = []
  const origASend = aLink.send.bind(aLink)
  const origSSend = sLink.send.bind(sLink)
  aLink.send = op => { toS.push(op); origASend(op) }
  sLink.send = op => { toA.push(op); origSSend(op) }
  attachAuthority(A, aLink, { cas: aCas })
  attachShadow(S, sLink, { cas: sCas })
  const drain = () => { while (sLink.inflight.length || aLink.inflight.length) { sLink.drainSide(); aLink.drainSide() } }
  return { A, S, aCas, sCas, sLink, aLink, toS, toA, drain }
}

describe("CAS sync: hit", () => {
  test("S has exact sha → renders from cache, zero text bytes over the wire", () => {
    const { A, S, sCas, toS, toA, drain } = rig()
    const text = "the quick brown fox\njumps over the lazy dog\n"
    A.addBuffer(new BufferModel({ id: "f1", name: "f1", text }))
    sCas.write(text) // S cached it last session

    announceBuffer(A, "f1")
    drain()

    expect(S.buffers.get("f1")?.text).toBe(text)
    expect(S.buffers.get("f1")?.locals.get("shadow-sync")).toBeUndefined()
    // A→S: only the BufferRef + the ack reply. No buffer/chunk/rebase.
    expect(toS.filter(o => o.kind === "chunk" || o.kind === "buffer" || o.kind === "rebase").length).toBe(0)
    // S→A: Have with the matching sha.
    expect(toA.find(o => o.kind === "have")).toEqual({ kind: "have", id: "f1", sha: sha256(text) })
  })
})

describe("CAS sync: miss", () => {
  test("S has nothing → Want → Chunks → text materializes and is CAS-written", () => {
    const { A, S, sCas, toS, toA, drain } = rig()
    const text = "content S has never seen"
    A.addBuffer(new BufferModel({ id: "f1", name: "f1", text }))

    announceBuffer(A, "f1")
    drain()

    expect(toA.find(o => o.kind === "want")).toEqual({ kind: "want", id: "f1" })
    expect(toS.some(o => o.kind === "chunk")).toBe(true)
    expect(S.buffers.get("f1")?.text).toBe(text)
    expect(S.buffers.get("f1")?.locals.get("shadow-sync")).toBeUndefined()
    // Next time is a hit.
    expect(sCas.lookup(sha256(text))).toBe(text)
  })

  test("multi-chunk reassembly", () => {
    const { A, S, aLink, drain } = rig()
    const text = "x".repeat(200_000)
    A.addBuffer(new BufferModel({ id: "big", name: "big", text }))
    announceBuffer(A, "big")
    drain()
    expect(S.buffers.get("big")?.text).toBe(text)
    void aLink
  })
})

describe("CAS sync: stale → rebase", () => {
  test("S has old version, A knows it → diff ships as rebase, not full text", () => {
    const { A, S, aCas, sCas, toS, toA, drain } = rig()
    const v1 = "line1\nline2\nline3\nline4\n"
    const v2 = "line1\nline2 changed\nline3\nline4 also\n"
    // A is at v2; both A and S have v1 in CAS (e.g. last session's save).
    A.addBuffer(new BufferModel({ id: "f1", name: "f1", text: v2 }))
    aCas.write(v1)
    const v1sha = sCas.write(v1)
    // S already has the buffer open at v1 from last session.
    const bufS = S.addBuffer(new BufferModel({ id: "f1", name: "f1", text: v1 }))
    bufS.locals.set("shadow-cached-sha", v1sha)
    // attachShadow ran before this addBuffer in rig(); hook it manually via a no-op
    // re-announce so the buffer-ref handler wires buf.link. (rig attaches first.)

    announceBuffer(A, "f1")
    drain()

    // S sent Have{v1sha}, not Want.
    expect(toA.find(o => o.kind === "have")).toEqual({ kind: "have", id: "f1", sha: v1sha })
    expect(toA.some(o => o.kind === "want")).toBe(false)
    // A replied with a rebase carrying the diff, not chunks.
    const rebase = toS.find(o => o.kind === "rebase")
    expect(rebase).toBeDefined()
    expect(toS.some(o => o.kind === "chunk")).toBe(false)
    // S converged.
    expect(S.buffers.get("f1")?.text).toBe(v2)
    expect(S.buffers.get("f1")?.locals.get("shadow-sync")).toBeUndefined()
    // And the diff was small — total spliced text < full v2 length.
    const sent = (rebase as { ops: { text: string }[] }).ops.reduce((n, o) => n + o.text.length, 0)
    expect(sent).toBeLessThan(v2.length)
  })

  test("S has version A can't reconstruct → falls back to chunks", () => {
    const { A, S, sCas, toS, drain } = rig()
    const v1 = "S's mystery local edit"
    const v2 = "A's authoritative text"
    A.addBuffer(new BufferModel({ id: "f1", name: "f1", text: v2 }))
    const bufS = S.addBuffer(new BufferModel({ id: "f1", name: "f1", text: v1 }))
    bufS.locals.set("shadow-cached-sha", sCas.write(v1))
    // A's CAS does NOT have v1.

    announceBuffer(A, "f1")
    drain()

    expect(toS.some(o => o.kind === "chunk")).toBe(true)
    expect(S.buffers.get("f1")?.text).toBe(v2)
  })
})

describe("CAS sync: post-sync editing", () => {
  test("after a hit, typing on S still flows to A and acks", () => {
    const { A, S, sCas, drain } = rig()
    const text = "base"
    const bufA = A.addBuffer(new BufferModel({ id: "f1", name: "f1", text }))
    sCas.write(text)
    announceBuffer(A, "f1")
    drain()

    const bufS = S.buffers.get("f1")!
    bufS.insert("X")
    drain()
    expect(bufA.text).toBe("Xbase")
    expect((shadowState(S)!.pending.get("f1") ?? []).length).toBe(0)
  })
})
