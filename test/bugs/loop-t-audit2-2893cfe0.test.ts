/**
 * t-audit2-2893cfe0: "ShadowState.sent grows unbounded — pruned only on
 *   rebase, never on ack."
 *
 * Duplicate — already fixed under t-audit2-c08f5f47 / t-audit2-3428ca14 via
 * the push-time `MAX_SENT` cap. The auditor's proposed fix (prune on ack) is
 * the wrong fix: a rebase reordered behind its ack still needs the entry to
 * map wire-seq → buf.seq for the rewind (t-f360d582). This test pins the
 * bound; see loop-t-audit2-c08f5f47 for the eviction-folds-into-baseBufSeq
 * invariant and loop-t-f360d582 for why ack must not prune.
 */
import { expect, test } from "bun:test"
import { Editor } from "../../src/kernel/editor"
import { BufferModel } from "../../src/kernel/buffer"
import { attachShadow, MAX_SENT, shadowState, type ShadowLink } from "../../src/shadow/shadow"
import { MemCas } from "../../src/shadow/cas"

test("ShadowState.sent is bounded at MAX_SENT without rebase or ack", () => {
  const link: ShadowLink = { peerId: "A", role: "shadow", trust: "full", send: () => {}, on: () => {}, close: () => {} }
  const S = new Editor()
  const buf = S.addBuffer(new BufferModel({ id: "b", name: "b", text: "" }))
  attachShadow(S, link, { cas: new MemCas() })

  for (let i = 0; i < MAX_SENT + 50; i++) buf.insert("x")

  expect(shadowState(S)!.sent.get("b")!.length).toBe(MAX_SENT)
})
