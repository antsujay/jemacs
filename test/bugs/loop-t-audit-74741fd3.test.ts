import { expect, test } from "bun:test"
import { makeEditor } from "../plugins/helper"
import * as textScale from "../../src/core/text-scale"

// t-audit-74741fd3 — lisp/misc.ts cleanup batch:
//   • dead `textScaleStep` import (core/text-scale never exported it)
//   • text-scale commands passed a 4th `{interactive}` arg to 3-ary editor.command
//   • module-level `let` for text-scale-adjust state leaked across Editor instances
test("text-scale-adjust transient map is per-editor (no module-level let)", async () => {
  const a = makeEditor()
  const b = makeEditor()

  await a.run("text-scale-adjust", ["1"])
  expect(a.overridingMap).not.toBeNull()
  await b.run("text-scale-adjust", ["1"])
  expect(b.overridingMap).not.toBeNull()

  // With shared module-level `let textScaleAdjustMap`, B's install overwrote the
  // tracked map, so A's keyboard-quit no longer recognises its own overriding map.
  await a.run("keyboard-quit")
  expect(a.overridingMap).toBeNull()
})

test("core/text-scale re-exports resolve from lisp/misc", () => {
  expect(typeof textScale.getTextScaleAmount).toBe("function")
  expect(typeof textScale.textScaleFactor).toBe("function")
  expect(typeof textScale.textScaleLighter).toBe("function")
  expect(typeof textScale.installTextScaleMode).toBe("function")
})
