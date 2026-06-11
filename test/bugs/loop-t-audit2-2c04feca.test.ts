import { expect, test } from "bun:test"
import { script } from "../harness"
import { Editor } from "../../src/kernel/editor"
import { install as installSimple } from "../../lisp/simple"
import { resetTestGlobals } from "../plugins/helper"
import { setPlatformRuntime, getPlatformRuntime } from "../../src/platform/runtime"

// t-audit2-2c04feca: GNU bindings.el binds <home>/<end> to line motion;
// only C-home/C-end go to buffer extremes. simple.ts had all four on the
// buffer commands. Asserted against a bare Editor + simple.install so the
// test owns what this file owns — default-bindings.ts is a separate layer.
test("home/end are line motion; C-home/C-end are buffer motion", () => {
  resetTestGlobals()
  const editor = new Editor()
  installSimple(editor)
  expect(editor.keymap.get("home")).toBe("move-beginning-of-line")
  expect(editor.keymap.get("end")).toBe("move-end-of-line")
  expect(editor.keymap.get("C-home")).toBe("beginning-of-buffer")
  expect(editor.keymap.get("C-end")).toBe("end-of-buffer")
})

// t-audit2-db6e88b4: Emacs replace-string operates from point to end of
// buffer (or within the active region). The old impl rewound to 0.
test("replace-string with no active region replaces from point forward", async () => {
  await script()
    .text("foo foo foo").point(4)
    .run("replace-string", "foo", "bar")
    .expect.text("foo bar bar")
    .done()
})

// Regression guard: the active-region path already worked and must keep working.
test("replace-string respects an active region", async () => {
  await script()
    .text("foo foo foo").point(4).mark(7)
    .run("replace-string", "foo", "bar")
    .expect.text("foo bar foo")
    .done()
})

// t-audit2-e1ad6157: cancelled prompt resolves null; Number(null)→0 fell
// through Math.max(1, …) to line 1. Abort must leave point and mark alone.
test("goto-line aborts cleanly when the prompt is cancelled", async () => {
  await script()
    .text("aaa\nbbb\nccc").point(5)
    .do(ed => { ed.prompt = async () => null })
    .run("goto-line")
    .expect.point(5)
    .expect.that((_, b) => expect(b.mark).toBeNull())
    .done()
})

// t-audit2-8f74067b: C-u 0 RET inserted nothing but then moveToLineStart()
// dragged point to column 0. Zero count must be a true no-op.
test("newline with prefix 0 is a no-op", async () => {
  await script()
    .text("abc").point(2)
    .do(ed => { ed.prefixArg.addDigit(0) })
    .run("newline")
    .expect.text("abc")
    .expect.point(2)
    .done()
})

// t-audit2-725881ec (1/2): undo / undo-redo dropped prefixArgument on the
// floor; C-u 3 C-/ should walk three steps.
test("undo and undo-redo honour the numeric prefix", async () => {
  const ed = await script()
    .text("").point(0)
    .run("self-insert-command", "a")
    .run("self-insert-command", "b")
    .run("self-insert-command", "c")
    .expect.text("abc")
    .do(ed => { ed.prefixArg.addDigit(3) })
    .run("undo")
    .expect.text("")
    .do(ed => { ed.prefixArg.addDigit(2) })
    .run("undo-redo")
    .expect.text("ab")
    .done()
  expect(ed.currentBuffer.text).toBe("ab")
})

// t-audit2-725881ec (2/2): bare `catch {}` around pbcopy/pbpaste swallowed
// every failure. ENOENT (no pbcopy on Linux) should still degrade quietly,
// but anything else must surface.
test("clipboard helpers only swallow ENOENT", async () => {
  const saved = getPlatformRuntime()
  try {
    setPlatformRuntime({ spawnProcess: () => { throw Object.assign(new Error("boom"), { code: "EACCES" }) } })
    await expect(
      script().text("hi").point(0).mark(2).run("clipboard-kill-ring-save").done(),
    ).rejects.toThrow(/boom/)

    setPlatformRuntime({ spawnProcess: () => { throw Object.assign(new Error("nope"), { code: "ENOENT" }) } })
    await script().text("hi").point(0).mark(2).run("clipboard-kill-ring-save").expect.message("Copied region").done()
  } finally {
    setPlatformRuntime(saved)
  }
})

// t-audit2-fa55cccf: repeat() helper had no callers — covered by deletion;
// no behavioural test needed.
