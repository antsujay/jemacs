import { test, expect } from "bun:test"
import { homedir } from "node:os"
import { script } from "../harness"

// t-7e1fa0b9: typing an absolute path after the prefilled directory must not
// yield a doubled path. Emacs `substitute-in-file-name` discards everything
// left of the last `//` or `/~` and expands a leading `~`.
test("find-file/dired: substitute-in-file-name on doubled and ~ paths", async () => {
  let openedFile = ""
  let openedDir = ""
  await script()
    .do(ed => {
      ed.openFile = async p => { openedFile = p; return ed.currentBuffer }
      ed.openDirectory = async p => { openedDir = p; return ed.currentBuffer }
    })
    // Headline repro: prefilled dir + typed absolute path → `//` restarts.
    .run("find-file", "/root/src/jemacs//root/src/jemacs/examples/task.go")
    .expect.that(() => expect(openedFile).toBe("/root/src/jemacs/examples/task.go"))
    // `/~` restarts at `~` AND expands to homedir so node:path resolve() works.
    .run("find-file", "/root/src/jemacs/~/notes.txt")
    .expect.that(() => expect(openedFile).toBe(`${homedir()}/notes.txt`))
    // Same shadow rule applies to the dired prompt.
    .run("dired", "/root/src/jemacs//etc")
    .expect.that(() => expect(openedDir).toBe("/etc"))
    .done()
})
