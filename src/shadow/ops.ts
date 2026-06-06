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

export type ShadowOp = Splice | Point | Buffer | Layout | Cmd | Ack | Rebase | Lsp

/**
 * Rebase a not-yet-ack'd splice over one that the authority already applied.
 * Semantics from DESIGN.md §Reconciliation: entirely-before → unchanged;
 * entirely-after → offset-shift; any overlap → null (target text changed
 * underfoot, so the pending edit is dropped and the user sees it didn't survive).
 * Ranges are half-open [from, to).
 */
export function transformSplice(pending: Splice, applied: Splice): Splice | null {
  const { from: aFrom, to: aTo, text: aText } = applied
  if (pending.to <= aFrom) return pending
  if (pending.from >= aTo) {
    const shift = aText.length - (aTo - aFrom)
    if (shift === 0) return pending
    return { ...pending, from: pending.from + shift, to: pending.to + shift }
  }
  return null
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
    case "layout":
    case "lsp":
      return `${op.kind}:${JSON.stringify(op)}`
  }
}
