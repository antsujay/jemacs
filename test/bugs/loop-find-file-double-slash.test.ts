import { test, expect } from "bun:test"
import { script } from "../harness"

test("find-file: '//' or '/~' in input restarts the path (substitute-in-file-name)", async () => {
  let opened = ""
  await script()
    .do(ed => { ed.openFile = async p => { opened = p; return ed.currentBuffer } })
    .run("find-file", "/a/b//etc/passwd")
    .expect.that(() => expect(opened).toBe("/etc/passwd"))
    .run("find-file", "/a/b/~/x")
    .expect.that(() => expect(opened).toBe(`${require("node:os").homedir()}/x`))
    .done()
})
