import { expect, test } from "bun:test"
import { script } from "../harness"

// Reported: "opening a file in dired should open a new buffer". Layer-3 test
// (open dir, RET on file, check C-x C-b) shows correct behavior. Either the
// repro is different (subdirectory? same-name file? after wdired?) or it's
// a layer-3-only interaction. Pinning what DOES work; will flip to .failing
// once the actual scenario is known.

test("dired-find-file on a regular file creates a distinct buffer (currently passes — bug not reproduced)", async () => {
  const editor = await script().do(async e => { await e.openFile("examples/docs") }).done()
  const diredBuf = editor.currentBuffer
  expect(diredBuf.mode).toBe("dired")
  // move to the guide.md line and RET
  await editor.run("end-of-buffer")
  await editor.run("dired-find-file")
  expect(editor.currentBuffer.name).toBe("guide.md")
  expect(editor.currentBuffer.id).not.toBe(diredBuf.id)
  expect([...editor.buffers.values()].some(b => b.id === diredBuf.id)).toBe(true)
})

// Passes at layer-1 (dired happens to be last-created before guide.md). Fails
// at layer-3 with full plugin set / longer buffer history. The fix is a real
// buffer-display recency list in killBuffer, not insertion-order fallback.
test.todo("kill-buffer after dired-find-file returns to dired, not *scratch* (layer-3 only — needs recency list)", async () => {
  const editor = await script().do(async e => { await e.openFile("examples/docs") }).done()
  const dired = editor.currentBuffer
  await editor.run("end-of-buffer")
  await editor.run("dired-find-file")
  expect(editor.currentBuffer.name).toBe("guide.md")
  await editor.run("kill-buffer")
  expect(editor.currentBuffer.id).toBe(dired.id)
})
