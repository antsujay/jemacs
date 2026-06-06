import type { BufferModel } from "../kernel/buffer"
import { transformSplice, type Seq, type Splice } from "./ops"

/**
 * Reconcile the shadow's buffer onto the authority's view (DESIGN.md §Reconciliation).
 *
 * 1. Rewind the buffer to `baseSeq` via the op-log undo tree.
 * 2. Apply `authorityOps` with `snapshot:false` — they become the new base, not a
 *    user-undoable step.
 * 3. Transform each `pending` op past every authority op and re-apply survivors.
 *
 * Returns the new pending list, position-aligned with the input: entries are `null`
 * where the pending op's range overlapped an authority op (target text changed
 * underfoot — the edit didn't survive). Survivors carry the buffer's fresh `seq`
 * so a subsequent rebase can rewind through them. Caller filters nulls.
 *
 * `onSplice` is suppressed for the duration so reconciliation doesn't echo to the link.
 */
export function rebaseBuffer(
  buffer: BufferModel,
  baseSeq: Seq,
  authorityOps: readonly Splice[],
  pending: readonly Splice[],
): (Splice | null)[] {
  const emit = buffer.onSplice
  buffer.onSplice = undefined
  try {
    buffer.rewindTo(baseSeq)
    for (const a of authorityOps) buffer.splice(a.from, a.to, a.text, { snapshot: false })

    const result: (Splice | null)[] = []
    for (const p of pending) {
      let t: Splice | null = p
      for (const a of authorityOps) {
        if (t === null) break
        t = transformSplice(t, a)
      }
      if (t === null) {
        result.push(null)
        continue
      }
      buffer.splice(t.from, t.to, t.text)
      result.push({ ...t, seq: buffer.seq })
    }
    return result
  } finally {
    buffer.onSplice = emit
  }
}
