import type { Editor } from "../kernel/editor"
import type { BufferModel } from "../kernel/buffer"
import { applyRemoteOp, type ShadowLink } from "./link"
import { transformSplice, type Seq, type ShadowOp, type Splice } from "./ops"

export type { ShadowLink } from "./link"
export type { ShadowOp, Splice, Seq } from "./ops"

type DisposeCtx = { onDispose(fn: () => void): void }

// ── State stashed in editor.locals ──────────────────────────────────────────

export type ShadowState = {
  link: ShadowLink
  nextSeq: Seq
  /** Ops sent to A, not yet ack'd. Each list is also mirrored to buffer.locals["shadow-pending"] for display. */
  pending: Map<string, Splice[]>
}

export type AuthorityState = {
  link: ShadowLink
  /** Highest seq from S applied per buffer; rebase.baseSeq comes from here. */
  lastSeq: Map<string, Seq>
  /** Splices that landed on A from somewhere other than S since lastSeq[bufferId]. */
  external: Map<string, Splice[]>
}

const SHADOW_KEY = "shadow"
const AUTHORITY_KEY = "shadow-authority"
const PENDING_KEY = "shadow-pending"

export function shadowState(editor: Editor): ShadowState | undefined {
  return editor.locals.get(SHADOW_KEY) as ShadowState | undefined
}

export function authorityState(editor: Editor): AuthorityState | undefined {
  return editor.locals.get(AUTHORITY_KEY) as AuthorityState | undefined
}

/** Run `fn` with `buf.onSplice` suppressed so kernel-level mutations don't echo over the link. */
function withoutEmit<T>(buf: BufferModel, fn: () => T): T {
  const prev = buf.onSplice
  buf.onSplice = undefined
  try { return fn() } finally { buf.onSplice = prev }
}

function setPending(editor: Editor, state: ShadowState, bufferId: string, list: Splice[]): void {
  state.pending.set(bufferId, list)
  editor.buffers.get(bufferId)?.locals.set(PENDING_KEY, list)
}

// ── Shadow side (S) ─────────────────────────────────────────────────────────

export function attachShadow(editor: Editor, link: ShadowLink, ctx?: DisposeCtx): () => void {
  const state: ShadowState = { link, nextSeq: 1, pending: new Map() }
  editor.locals.set(SHADOW_KEY, state)

  const restore: Array<() => void> = []
  const hookBuffer = (buf: BufferModel) => {
    const prev = buf.onSplice
    buf.link = link
    buf.onSplice = s => {
      const op: Splice = { ...s, seq: state.nextSeq++ }
      const list = state.pending.get(buf.id) ?? []
      list.push(op)
      setPending(editor, state, buf.id, list)
      link.send(op)
    }
    restore.push(() => { buf.onSplice = prev; buf.link = undefined; buf.locals.delete(PENDING_KEY) })
  }
  for (const b of editor.buffers.values()) hookBuffer(b)

  link.on(op => onShadowOp(editor, link, state, op, hookBuffer))

  const detach = () => {
    for (const r of restore) r()
    editor.locals.delete(SHADOW_KEY)
  }
  ctx?.onDispose(detach)
  return detach
}

/** S-side receive: ack/rebase/lsp handled here; splice/point/buffer/layout via the chokepoint. */
function onShadowOp(editor: Editor, link: ShadowLink, state: ShadowState, op: ShadowOp, hookBuffer: (b: BufferModel) => void): void {
  switch (op.kind) {
    case "ack": {
      for (const [id, list] of state.pending) {
        setPending(editor, state, id, list.filter(p => p.seq > op.upTo))
      }
      break
    }
    case "rebase": {
      const buf = editor.buffers.get(op.bufferId)
      if (!buf) break
      const list = state.pending.get(op.bufferId) ?? []
      const toRewind = list.filter(p => p.seq > op.baseSeq)
      withoutEmit(buf, () => {
        // 1. Rewind optimistic state past baseSeq.
        for (let i = 0; i < toRewind.length; i++) buf.undo()
        // 2. Apply A's ops.
        for (const a of op.ops) buf.replaceRange(a.from, a.to, a.text)
        // 3. Transform surviving pending past A's ops, re-apply.
        const survived: Splice[] = []
        for (const p of toRewind) {
          let t: Splice | null = p
          for (const a of op.ops) t = t && transformSplice(t, a)
          if (t) { buf.replaceRange(t.from, t.to, t.text); survived.push(t) }
        }
        // 4. Pending now relative to A's tip.
        setPending(editor, state, op.bufferId, survived)
      })
      break
    }
    case "lsp":
      editor.buffers.get(op.bufferId)?.locals.set("shadow-lsp", op)
      break
    case "buffer": {
      applyRemoteOp(editor, link, op)
      const buf = editor.buffers.get(op.id)
      if (buf) hookBuffer(buf)
      break
    }
    case "splice":
    case "point":
    case "layout":
      applyRemoteOp(editor, link, op)
      break
    case "command":
      // S→A only; never honored on S.
      break
  }
  void editor.changed("shadow-remote")
}

// ── Authority side (A) ──────────────────────────────────────────────────────

export function attachAuthority(editor: Editor, link: ShadowLink, ctx?: DisposeCtx): () => void {
  const state: AuthorityState = { link, lastSeq: new Map(), external: new Map() }
  editor.locals.set(AUTHORITY_KEY, state)

  const restore: Array<() => void> = []
  for (const buf of editor.buffers.values()) {
    const prev = buf.onSplice
    // Any splice that fires while onSplice is installed is, by construction, *not*
    // from S (applyRemoteOp suppresses the hook), so it's an external edit.
    buf.onSplice = s => {
      const list = state.external.get(buf.id) ?? []
      list.push(s)
      state.external.set(buf.id, list)
    }
    restore.push(() => { buf.onSplice = prev })
  }

  link.on(op => onAuthorityOp(editor, link, state, op))

  const detach = () => {
    for (const r of restore) r()
    editor.locals.delete(AUTHORITY_KEY)
  }
  ctx?.onDispose(detach)
  return detach
}

/** A-side receive: S may send splice/point/command. Anything else is wrong-direction. */
function onAuthorityOp(editor: Editor, link: ShadowLink, state: AuthorityState, op: ShadowOp): void {
  switch (op.kind) {
    case "splice": {
      const ext = state.external.get(op.bufferId)
      if (ext?.length) {
        link.send({ kind: "rebase", bufferId: op.bufferId, baseSeq: state.lastSeq.get(op.bufferId) ?? 0, ops: ext })
        state.external.set(op.bufferId, [])
        // S's op was relative to the pre-ext state; shift it past what we just told S about.
        let t: Splice | null = op
        for (const a of ext) t = t && transformSplice(t, a)
        if (t) applyRemoteOp(editor, link, t)
      } else {
        applyRemoteOp(editor, link, op)
      }
      state.lastSeq.set(op.bufferId, op.seq)
      link.send({ kind: "ack", upTo: op.seq })
      break
    }
    case "point":
      applyRemoteOp(editor, link, op)
      state.lastSeq.set(op.bufferId, op.seq)
      link.send({ kind: "ack", upTo: op.seq })
      break
    case "command":
      applyRemoteOp(editor, link, op)
      link.send({ kind: "ack", upTo: op.seq })
      break
    default:
      // ack/rebase/buffer/layout/lsp are A→S only.
      break
  }
}
