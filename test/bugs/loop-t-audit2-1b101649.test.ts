import { expect, test } from "bun:test"
import { MemCas } from "../../src/shadow/cas"
import { ManifestCache } from "../../src/shadow/manifest"
import { chunkText, type Chunk, type Cmd, type ShadowOp } from "../../src/shadow/ops"
import { createRemoteRuntime } from "../../src/shadow/remote-runtime"
import type { ShadowLink } from "../../src/shadow/link"

// ── t-audit2-9ea5d14a: chunkText must not split surrogate pairs ─────────────
// A lone surrogate JSON-stringifies fine but is replaced with U+FFFD by any
// UTF-8 transport (TextEncoder, ws.send(string)), so a torn pair corrupts the
// reassembled text. chunkText must keep each pair in one chunk.

/** Reassemble via the same offset→length chain shadow.ts / remote-runtime.ts use. */
function reassemble(chunks: Chunk[]): string {
  const byOff = new Map(chunks.map(c => [c.offset, c]))
  let text = "", at = 0
  for (;;) {
    const c = byOff.get(at)
    if (!c) throw new Error(`gap at offset ${at}`)
    text += c.data
    if (c.eof) return text
    at += c.data.length
  }
}

const isLoneHigh = (cu: number) => cu >= 0xd800 && cu <= 0xdbff
const isLoneLow = (cu: number) => cu >= 0xdc00 && cu <= 0xdfff

test("chunkText: boundary landing inside a surrogate pair keeps the pair together", () => {
  // "xxx😀yyy" — 😀 is 😀. size=4 puts the naive boundary between them.
  const text = "xxx\u{1F600}yyy"
  const chunks = chunkText("b", text, 4)
  for (const c of chunks) {
    expect(isLoneHigh(c.data.charCodeAt(c.data.length - 1))).toBe(false)
    expect(isLoneLow(c.data.charCodeAt(0))).toBe(false)
  }
  expect(reassemble(chunks)).toBe(text)
})

test("chunkText: dense astral-plane text round-trips at every small size", () => {
  const text = "a\u{1F600}b\u{1F468}\u{1F3FB}c\u{1D11E}".repeat(7)
  for (let size = 1; size <= 8; size++) {
    const chunks = chunkText("b", text, size)
    expect(reassemble(chunks)).toBe(text)
    // Survives a UTF-8 hop: no chunk contains an unpaired surrogate.
    for (const c of chunks) {
      expect(isLoneHigh(c.data.charCodeAt(c.data.length - 1))).toBe(false)
      expect(isLoneLow(c.data.charCodeAt(0))).toBe(false)
    }
  }
})

// ── t-audit2-1b101649: pre-attachShadow Cmd seqs collide with state.nextSeq ──
// createRemoteRuntime ships Cmds from a private counter starting at 1.
// attachShadow then sets state.nextSeq=1 and rebinds — so the first post-attach
// op reuses a seq A has already consumed, and A's `seq <= recvSeq` gate drops it.
// Fix lives in remote-runtime.ts/shadow.ts (outside this task's owned file);
// this test documents the violation of ops.ts's "monotone per peerId" invariant.

test.failing("bindSeq lifecycle: pre-attach Cmds don't collide with post-attach seq", async () => {
  const sent: ShadowOp[] = []
  const link: ShadowLink = {
    peerId: "A", role: "shadow", trust: "full",
    send: op => { sent.push(op) },
    on: () => {},
    close: () => {},
  }
  const rt = createRemoteRuntime(link, new ManifestCache(), new MemCas())

  // Pre-attach: runtime uses its own counter (1, 2, …).
  await rt.writeFileText("/a", "x")
  await rt.writeFileText("/b", "y")

  // attachShadow's wiring: state.nextSeq = 1, then rt.bindSeq(() => state.nextSeq++).
  let nextSeq = 1
  rt.bindSeq(() => nextSeq++)

  // Post-attach Cmd — must not reuse a seq A already saw.
  await rt.writeFileText("/c", "z")

  const seqs = sent.filter((o): o is Cmd => o.kind === "command").map(o => o.seq)
  expect(seqs.length).toBe(3)
  expect(new Set(seqs).size).toBe(seqs.length)
})
