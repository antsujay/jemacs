import { test, expect } from "bun:test"
import { fakeLspServer, fakeLspClient } from "../harness"
import { BufferModel } from "../../src/kernel/buffer"
import { startWorkspace } from "../../src/lsp/workspace"
import { lspCompletionAtPoint } from "../../src/lsp/completion"

test("lsp completion: filter RA candidates by typed prefix", async () => {
  const buf = new BufferModel({ name: "a.rs", text: "Cou", path: "/p/a.rs" })
  buf.point = 3
  const server = fakeLspServer()
  const starting = startWorkspace(fakeLspClient(server), "/p", [buf])
  server.respond(server.lastRequestId()!, { capabilities: {} })
  const ws = await starting
  const completing = lspCompletionAtPoint(buf, [ws])
  server.respond(server.lastRequestId()!, [
    { label: "pub(crate)", sortText: "0000" },
    { label: "Count", sortText: "0010" },
    { label: "Counter", filterText: "Counter", sortText: "0011" },
  ])
  expect((await completing).map(c => c.text)).toEqual(["Count", "Counter"])
})
