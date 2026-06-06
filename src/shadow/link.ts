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
      if (link.role !== "authority") return false
      if (link.trust !== "full") return false
      void editor.run(op.name, op.args as string[])
      return true
    }
    case "ack":
    case "rebase":
    case "lsp":
      // Reconciliation / plugin-stub ops — consumed by the shadow layer, not the kernel.
      return true
  }
}
