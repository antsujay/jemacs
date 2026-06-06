import { describe, expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { attachShadow, shadowState, type ShadowLink, type ShadowOp } from "../../src/shadow/shadow"
import { getCustomFace } from "../../src/runtime/faces"
import {
  install,
  shadowModeLighter,
  shadowPendingSpans,
  SHADOW_PENDING_FACE,
  SHADOW_PENDING_LOCAL,
} from "../../plugins/shadow"

/** Shadow-side link that queues outbound ops and lets the test feed inbound ones. */
function queuedLink() {
  const sent: ShadowOp[] = []
  let recv: (op: ShadowOp) => void = () => {}
  const link: ShadowLink & { partitioned: boolean } = {
    peerId: "A", role: "shadow", trust: "full", partitioned: false,
    send: op => sent.push(op),
    on: h => { recv = h },
    close: () => {},
  }
  return { link, sent, deliver: (op: ShadowOp) => recv(op) }
}

describe("shadow plugin", () => {
  test("defface registers shadow-pending as dim/italic", () => {
    install(new Editor())
    const face = getCustomFace("shadow-pending")
    expect(face).toBeDefined()
    expect(face!.spec.italic).toBe(true)
    expect(face!.spec.fg).toBeDefined()
  })

  test("overlay spans cover pending ops; ack shrinks them", () => {
    const editor = new Editor()
    install(editor)
    const buf = editor.addBuffer(new BufferModel({ id: "buf-1", name: "t", text: "" }))
    const { link, sent, deliver } = queuedLink()
    attachShadow(editor, link)

    // Two optimistic edits → two pending splices.
    buf.insert("hello")
    buf.insert(" world")
    expect(buf.text).toBe("hello world")
    const pending = buf.locals.get(SHADOW_PENDING_LOCAL) as unknown[]
    expect(pending.length).toBe(2)

    // Spans cover both inserts in *current* coordinates: "hello"=[0,5), " world"=[5,11).
    let spans = shadowPendingSpans(buf)
    expect(spans).toEqual([
      { start: 0, end: 5, face: SHADOW_PENDING_FACE },
      { start: 5, end: 11, face: SHADOW_PENDING_FACE },
    ])
    // Overlay source is wired into fontLock.
    expect(editor.fontLock(buf).filter(s => s.face === SHADOW_PENDING_FACE)).toEqual(spans)

    // Ack the first op → only " world" remains pending.
    expect(sent[0]!.kind).toBe("splice")
    deliver({ kind: "ack", upTo: (sent[0] as { seq: number }).seq })
    expect(shadowState(editor)!.pending.get("buf-1")!.length).toBe(1)

    spans = shadowPendingSpans(buf)
    expect(spans).toEqual([{ start: 5, end: 11, face: SHADOW_PENDING_FACE }])

    // Ack the rest → no spans.
    deliver({ kind: "ack", upTo: (sent[1] as { seq: number }).seq })
    expect(shadowPendingSpans(buf)).toEqual([])
  })

  test("earlier span shifts past a later non-adjacent insert", () => {
    const editor = new Editor()
    install(editor)
    const buf = editor.addBuffer(new BufferModel({ id: "buf-2", name: "t", text: "abcdef" }))
    const { link } = queuedLink()
    attachShadow(editor, link)

    buf.point = 6
    buf.insert("XY")          // pending[0] at [6,8) — current coords [8,10) after next op
    buf.point = 0
    buf.insert("__")          // pending[1] at [0,2)
    expect(buf.text).toBe("__abcdefXY")

    expect(shadowPendingSpans(buf)).toEqual([
      { start: 8, end: 10, face: SHADOW_PENDING_FACE },
      { start: 0, end: 2, face: SHADOW_PENDING_FACE },
    ])
  })

  test("modeline lighter reflects pending count and link state", () => {
    const editor = new Editor()
    install(editor)
    const buf = editor.addBuffer(new BufferModel({ id: "buf-3", name: "t", text: "" }))

    // No link → no segment.
    expect(shadowModeLighter(buf)).toBe("")

    const { link, deliver } = queuedLink()
    attachShadow(editor, link)
    expect(shadowModeLighter(buf)).toBe(" [✓]")

    buf.insert("a")
    buf.insert("b")
    expect(shadowModeLighter(buf)).toBe(" [⇅ 2]")

    deliver({ kind: "ack", upTo: 1 })
    expect(shadowModeLighter(buf)).toBe(" [⇅ 1]")

    deliver({ kind: "ack", upTo: 2 })
    expect(shadowModeLighter(buf)).toBe(" [✓]")

    link.partitioned = true
    expect(shadowModeLighter(buf)).toBe(" [⊘ partition]")
  })
})
