import { test, expect } from "bun:test"
import { script, parseKey } from "../harness"

// t-a2796ca7: M-% per-match prompt was a text minibuffer (`editor.prompt`), so
// y/n/q self-inserted instead of dispatching. Fixed by `readKey` consuming the
// next handleKey directly. This repro drives the full M-% → prompt → prompt
// path; the older inbox-12 test passed args to `run()` and never opened the
// minibuffer, so a regression in the prompted path would slip through.
//
// Keys are fired without awaiting (the M-% handleKey doesn't resolve until
// query-replace finishes) and microtasks are flushed between them — same
// interleaving the real host produces.
const tick = () => new Promise(r => setTimeout(r, 0))

test("query-replace via M-%: y/n/q dispatch on a single key, not minibuffer text", async () => {
  const ed = await script({ plugins: false }).text("Tag and Tag and Tag").point(0).done()
  const fire = (t: string) => { void ed.handleKey(parseKey(t)) }

  fire("M-%"); await tick()
  expect(ed.minibuffer?.prompt).toBe("Query replace: ")
  for (const c of "Tag") fire(c); await tick()
  fire("Enter"); await tick()
  for (const c of "Label") fire(c); await tick()
  fire("Enter"); await tick()

  // Per-match loop is now active. Pre-fix, a third minibuffer would be open
  // here with prompt 'Replace "Tag"? (y/n/q) ' and 'y' would self-insert.
  // (Compare on a primitive — toBeNull() tries to serialize the request object,
  // which closes over the editor and hangs the diff printer.)
  expect(ed.minibuffer == null).toBe(true)

  fire("y"); await tick() // replace 1st
  fire("n"); await tick() // skip 2nd
  fire("q"); await tick() // quit before 3rd

  expect(ed.minibuffer == null).toBe(true)
  expect(ed.currentBuffer.text).toBe("Label and Tag and Tag")
})

test("query-replace via M-%: ! replaces all remaining without Enter", async () => {
  const ed = await script({ plugins: false }).text("a a a a").point(0).done()
  const fire = (t: string) => { void ed.handleKey(parseKey(t)) }

  fire("M-%"); await tick()
  fire("a"); await tick(); fire("Enter"); await tick()
  fire("b"); await tick(); fire("Enter"); await tick()
  fire("n"); await tick() // skip first
  fire("!"); await tick() // replace rest unconditionally

  expect(ed.minibuffer == null).toBe(true)
  expect(ed.currentBuffer.text).toBe("a b b b")
})
