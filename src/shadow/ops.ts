import type { WindowNode } from "../kernel/window"

/** Monotone per (peerId) — one counter per link, across all op kinds. */
export type Seq = number

export type Splice = { kind: "splice"; bufferId: string; from: number; to: number; text: string; seq: Seq }
export type Point = { kind: "point"; bufferId: string; point: number; seq: Seq }
export type Buffer = { kind: "buffer"; id: string; path?: string; text: string; mode: string }
export type Layout = { kind: "layout"; tree: WindowNode }
/** S→A only, and only honored when the link's server-assigned trust is "full". */
export type Cmd = { kind: "command"; name: string; args: unknown[]; seq: Seq }
export type Ack = { kind: "ack"; upTo: Seq }
export type Rebase = { kind: "rebase"; bufferId: string; baseSeq: Seq; ops: Splice[] }
/** Payload types kept opaque here so ops.ts stays leaf-level (no kernel/lsp cycle). */
export type Lsp = { kind: "lsp"; bufferId: string; diagnostics?: unknown[]; hover?: string; completion?: unknown[] }

// Content-addressed buffer sync (DESIGN.md §Content-addressed). A→S: BufferRef, Chunk. S→A: Have, Want.
/** Like `Buffer` but ships sha instead of text — S decides hit/stale/miss. */
export type BufferRef = { kind: "buffer-ref"; id: string; path?: string; sha: string; mode: string }
/** S→A: I have content with this sha (may differ from BufferRef.sha → stale). */
export type Have = { kind: "have"; id: string; sha: string }
/** S→A: cache miss, stream me the text. */
export type Want = { kind: "want"; id: string }
/** A→S: one slice of buffer text. Last chunk carries eof. */
export type Chunk = { kind: "chunk"; id: string; offset: number; data: string; eof?: true }

// Filesystem manifest (DESIGN.md §Filesystem replica). A→S: ManifestTree, ManifestDelta. S→A: ManifestReq.
/** One file's manifest row. `sha` keys the CAS; `mode/size/mtime` for dired. */
export type ManifestEntry = { path: string; sha: string; mode: number; size: number; mtime: number }
/** A→S: full listing of one directory. `root` is the project root hash; `dir` the subtree this answers. */
export type ManifestTree = { kind: "manifest-tree"; root: string; dir: string; entries: ManifestEntry[] }
/** A→S: watcher-driven incremental update. `old` absent ⇒ create; `new` absent ⇒ delete. */
export type ManifestDelta = { kind: "manifest-delta"; changes: Array<{ path: string; old?: string; new?: ManifestEntry }> }
/** S→A: send me the manifest subtree at `dir` (lazy — only dirs S has visited). */
export type ManifestReq = { kind: "manifest-req"; dir: string }

export type ShadowOp =
  | Splice | Point | Buffer | Layout | Cmd | Ack | Rebase | Lsp
  | BufferRef | Have | Want | Chunk
  | ManifestTree | ManifestDelta | ManifestReq

/**
 * Rebase a not-yet-ack'd splice over one that the authority already applied.
 * Semantics from DESIGN.md §Reconciliation: entirely-before → unchanged;
 * entirely-after → offset-shift; any overlap → null (target text changed
 * underfoot, so the pending edit is dropped and the user sees it didn't survive).
 * Ranges are half-open [from, to).
 *
 * `pendingBefore` is the tie-break for two pure inserts at the same point:
 * true (default) ⇒ pending lands before applied (unchanged); false ⇒ after (shifted).
 * The OT convergence property base+A+B' ≡ base+B+A' requires opposite tie-breaks
 * on the two transform calls — A side uses true for S's op, false when advancing
 * its own external past S's op.
 */
export function transformSplice(pending: Splice, applied: Splice, pendingBefore = true): Splice | null {
  const { from: aFrom, to: aTo, text: aText } = applied
  // Two pure inserts at the same point: tie-break decides order.
  if (pending.from === pending.to && aFrom === aTo && pending.from === aFrom) {
    if (pendingBefore || aText.length === 0) return pending
    return { ...pending, from: pending.from + aText.length, to: pending.to + aText.length }
  }
  if (pending.to <= aFrom) return pending
  if (pending.from >= aTo) {
    const shift = aText.length - (aTo - aFrom)
    if (shift === 0) return pending
    return { ...pending, from: pending.from + shift, to: pending.to + shift }
  }
  return null
}

/** Transform `p` past a sequence of applied ops. Returns null if any step overlaps. */
export function transformPast(p: Splice, applied: readonly Splice[], pendingBefore = true): Splice | null {
  let t: Splice | null = p
  for (const a of applied) {
    if (t === null) return null
    t = transformSplice(t, a, pendingBefore)
  }
  return t
}

/** Advance each op in `ops` past `p` (opposite tie-break). Nulls are dropped. */
export function advancePast(ops: readonly Splice[], p: Splice): Splice[] {
  const out: Splice[] = []
  for (const o of ops) {
    const t = transformSplice(o, p, false)
    if (t) out.push(t)
  }
  return out
}

/** Dedup key for FakeLink's `dup` adversary. Seq-bearing ops key on seq alone
 *  (monotone per peer ⇒ unique); the rest are idempotent enough to key on content. */
export function opKey(op: ShadowOp): string {
  switch (op.kind) {
    case "splice":
    case "point":
    case "command":
      return `${op.kind}:${op.seq}`
    case "ack":
      return `ack:${op.upTo}`
    case "buffer":
      return `buffer:${op.id}`
    case "rebase":
      return `rebase:${op.bufferId}:${op.baseSeq}`
    case "buffer-ref":
      return `buffer-ref:${op.id}:${op.sha}`
    case "have":
      return `have:${op.id}:${op.sha}`
    case "want":
      return `want:${op.id}`
    case "chunk":
      return `chunk:${op.id}:${op.offset}`
    case "manifest-tree":
      return `manifest-tree:${op.dir}:${op.root}`
    case "manifest-delta":
      return `manifest-delta:${op.changes.map(c => `${c.path}@${c.new?.sha ?? "-"}`).join(",")}`
    case "manifest-req":
      return `manifest-req:${op.dir}`
    case "layout":
    case "lsp":
      return `${op.kind}:${JSON.stringify(op)}`
  }
}
