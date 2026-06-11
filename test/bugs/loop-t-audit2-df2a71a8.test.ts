import { afterEach, expect, test } from "bun:test"
import { buildDisplayModel } from "../../src/display/build-display-model"
import type { SerializedDisplayModel, SerializedWindowNode } from "../../src/display/serialize"
import { createWebHost, type WebHost } from "../../src/web/host"
import { makeEditor } from "../plugins/helper"

// t-audit2-df2a71a8 — present(model) discarded the incoming DisplayModel and
// rebuilt from scratch (`_model` was unread; hostLabel came from `this.label`).
//
// Resolution (commit 52b0686, src/web/host.ts):
//   • `model.hostLabel` now flows through — the param is no longer fully ignored.
//   • The rest of `model` is *intentionally* re-derived via
//     buildLogicalModel→webLayout: the incoming model is char-grid (cursor baked
//     in as a █ glyph), but the DOM client needs `pane.cursor` coordinates that
//     only `webLayout(LogicalModel)` produces. Same-tick editor read so no
//     divergence. The wasted upstream `layoutCharGrid` belongs to
//     `bindJemacsHost` (give pixel hosts the LogicalModel directly) — out of
//     scope for an `OWNS: src/web/host.ts` change.
//
// This test pins the part that *was* a bug: hostLabel must come from `model`,
// not the host's own `.label`. Reverting to `_model` / `this.label` fails it.

let host: WebHost | undefined

afterEach(() => {
  host?.destroy()
  host = undefined
})

function leaf(node: SerializedWindowNode) {
  return node.kind === "leaf" ? node.pane : leaf(node.first)
}

function nextModel(ws: WebSocket): Promise<SerializedDisplayModel> {
  return new Promise(resolve => {
    ws.addEventListener("message", e => resolve(JSON.parse(String(e.data))), { once: true })
  })
}

test("present() consumes model.hostLabel; rebuild path emits webLayout cursor", async () => {
  const editor = makeEditor()
  editor.scratch("t-df2a71a8", "abc", "text")
  host = await createWebHost({ port: 0, authTimeoutMs: 1000 })
  host.attachEditor(editor)

  // Hand present() a char-grid model whose hostLabel is NOT the host's own
  // label. Pre-fix this value was dropped on the floor.
  const fromCaller = "X-From-Model"
  expect(fromCaller).not.toBe(host.label)
  const model = buildDisplayModel(editor, {
    viewport: host.getViewport(),
    hostLabel: fromCaller,
    hostCapabilities: host.capabilities,
  })
  host.present(model)

  // Auth a socket; on auth the host pushes lastModel (set by the present above).
  const ws = new WebSocket(`ws://127.0.0.1:${host.port}/ws`)
  await new Promise<void>(r => ws.addEventListener("open", () => r(), { once: true }))
  const received = nextModel(ws)
  ws.send(JSON.stringify({ type: "auth", token: host.token }))
  const wire = await received
  ws.close()

  // hostLabel propagated from `model`, not from `this.label`.
  expect(wire.hostLabel).toBe(fromCaller)
  // The broadcast is webLayout output, not a serialized char-grid: it carries a
  // positioned cursor (no █ baked into body) — the reason the rebuild exists.
  const pane = leaf(wire.windows)
  expect(pane.cursor).toBeDefined()
  expect(pane.body.chunks.map(c => c.text).join("")).not.toContain("█")
})
