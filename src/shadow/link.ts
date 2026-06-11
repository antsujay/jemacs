import type { Editor } from "../kernel/editor"
import { BufferModel } from "../kernel/buffer"
import type { ShadowOp } from "./ops"

/** Which side of the A↔S pair this link instance lives on. Determines which op
 *  kinds `applyRemoteOp` will honor — Cmd is only ever processed by the authority. */
export type ShadowRole = "authority" | "shadow"

export interface ShadowLink {
  readonly peerId: string
  readonly role: ShadowRole
  /** Server-assigned per-auth; never read from the wire. */
  readonly trust: "full" | "propose"
  send(op: ShadowOp): void
  on(handler: (op: ShadowOp) => void): void
  close(): void
}

/** Rejection thrown into every pending `Coalescer` waiter when the link drops,
 *  so callers see an error instead of a Promise that never settles. */
export class LinkClosed extends Error {
  constructor(peerId?: string) {
    super(peerId ? `shadow link '${peerId}' closed` : "shadow link closed")
    this.name = "LinkClosed"
  }
}

type Waiter<T> = { resolve: (v: T) => void; reject: (e: unknown) => void }

/**
 * Request-coalescing waiter map with a close valve.
 *
 * This is the `dirWaiters`/`wantWaiters` pattern from the remote runtime — N
 * concurrent callers ask for the same key, send the wire request once, fan the
 * reply out to all — pulled here so it can be tied to the link's lifetime. The
 * hand-rolled maps held bare `resolve` callbacks, so a `link.close()` (or a
 * dropped `Chunk` that left a gap in the reassembly) meant `readFileText` /
 * `stat` / `readdir` hung forever with no way to surface an error.
 *
 * `request(key, send)` calls `send` only for the first waiter on `key`.
 * `resolve`/`reject` settle every waiter for one key. `resend(key)` re-fires
 * the stored `send` for a still-pending key — the retransmit hook for the
 * chunk stream, which has no seq/ack of its own (a stalled reassembly re-issues
 * the `Want` and A re-streams; chunk application is idempotent on offset).
 * `close()` rejects everything with `LinkClosed` and latches: later `request`s
 * reject immediately.
 */
export class Coalescer<T = void> {
  private readonly waiters = new Map<string, Waiter<T>[]>()
  private readonly senders = new Map<string, () => void>()
  private dead?: Error

  /** Coalesced request: `send` fires only when `key` has no in-flight waiter. */
  request(key: string, send?: () => void): Promise<T> {
    if (this.dead) return Promise.reject(this.dead)
    let list = this.waiters.get(key)
    const first = !list
    if (!list) this.waiters.set(key, list = [])
    return new Promise<T>((resolve, reject) => {
      list.push({ resolve, reject })
      if (first && send) {
        this.senders.set(key, send)
        try { send() } catch (e) { this.reject(key, e) }
      }
    })
  }

  has(key: string): boolean {
    return this.waiters.has(key)
  }

  /** Re-fire the original `send` for a still-pending key. No-op once settled. */
  resend(key: string): boolean {
    if (this.dead) return false
    const s = this.senders.get(key)
    if (!s || !this.waiters.has(key)) return false
    try { s() } catch (e) { this.reject(key, e); return false }
    return true
  }

  resolve(key: string, value: T): number {
    return this.settle(key, w => w.resolve(value))
  }

  reject(key: string, err: unknown): number {
    return this.settle(key, w => w.reject(err))
  }

  private settle(key: string, f: (w: Waiter<T>) => void): number {
    const list = this.waiters.get(key)
    if (!list) return 0
    this.waiters.delete(key)
    this.senders.delete(key)
    for (const w of list) f(w)
    return list.length
  }

  /** Reject every pending waiter and refuse further requests. Idempotent. */
  close(err: Error = new LinkClosed()): void {
    if (this.dead) return
    this.dead = err
    const all = [...this.waiters.values()]
    this.waiters.clear()
    this.senders.clear()
    for (const list of all) for (const w of list) w.reject(err)
  }
}

/**
 * Single entry point for ops arriving over a link. Everything inbound funnels
 * here so the direction/trust gates (DESIGN.md §Ops) live in one place.
 *
 * Returns false when the op was rejected (wrong direction, untrusted Cmd,
 * unknown buffer) so the caller can surface it; true otherwise.
 */
export function applyRemoteOp(editor: Editor, link: ShadowLink, op: ShadowOp): boolean {
  switch (op.kind) {
    case "splice": {
      const buf = editor.buffers.get(op.bufferId)
      if (!buf) return false
      // Suppress the outbound emit so a remote splice doesn't echo back.
      const emit = buf.onSplice
      buf.onSplice = undefined
      try {
        buf.replaceRange(op.from, op.to, op.text)
      } finally {
        buf.onSplice = emit
      }
      return true
    }
    case "point": {
      const buf = editor.buffers.get(op.bufferId)
      if (!buf) return false
      buf.point = op.point
      return true
    }
    case "buffer": {
      const buf = new BufferModel({ id: op.id, name: op.path ?? op.id, path: op.path, text: op.text, mode: op.mode })
      buf.link = link
      editor.addBuffer(buf)
      return true
    }
    case "layout":
      // Window-tree restoration needs an Editor primitive that doesn't exist yet;
      // accepted but unapplied until that lands.
      return true
    case "command": {
      // trust:"full" means the peer is the same user over an SSH-auth'd channel —
      // executing arbitrary commands is the *purpose* (M-x compile runs on A).
      // The security boundary is the link's auth handshake, not an allowlist here.
      // See DESIGN.md § Transport. trust is set server-side per auth, never from the wire.
      if (link.role !== "authority" || link.trust !== "full") {
        editor.message(`[shadow] rejected command '${String(op.name).slice(0, 40)}' on ${link.role}/${link.trust} link`)
        return false
      }
      if (typeof op.name !== "string" || !Array.isArray(op.args)) return false
      editor.run(op.name, op.args.map(a => typeof a === "string" ? a : String(a)))
        .catch((e: unknown) => editor.message(`[shadow] command '${op.name}' failed: ${(e as Error)?.message ?? e}`))
      return true
    }
    case "ack":
    case "rebase":
    case "lsp":
    case "buffer-ref":
    case "have":
    case "want":
    case "chunk":
    case "manifest-tree":
    case "manifest-delta":
    case "manifest-req":
      // Reconciliation / CAS-sync / manifest / plugin-stub ops — consumed by the shadow layer, not the kernel.
      return true
  }
}
