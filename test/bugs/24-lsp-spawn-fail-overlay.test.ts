import { test } from "bun:test"
import { script, fakeLspServer, fakeLspClient } from "../harness"
import { registerClient } from "../../src/lsp/client"
import { LspManager } from "../../src/lsp/manager"

test("lsp() surfaces spawn failure as an editor message instead of throwing", async () => {
  registerClient({
    ...fakeLspClient(fakeLspServer(), { modes: ["bug24"], serverId: "bug24-ls" }),
    newConnection: { connect: () => { throw new Error("spawn ENOENT bug24-ls") } },
  })
  await script({ plugins: false })
    .do((ed, buf) => { buf.path = "/tmp/bug24.xx"; buf.mode = "bug24"; ed.lsp = new LspManager(ed) })
    .do(ed => ed.lsp!.lsp())
    .expect.message("failed")
    .done()
})
