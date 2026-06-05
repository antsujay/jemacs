import { expect, test } from "bun:test"
import { listWindowLeaves } from "../../src/kernel/window"
import { script } from "../harness"

test("ensure-other-window reuses existing free window instead of splitting", async () => {
  await script()
    .do(ed => ed.splitWindowBelow())
    .expect.that(ed => expect(listWindowLeaves(ed.windowLayout).length).toBe(2))
    .do(ed => ed.ensureOtherWindowSelected())
    .expect.that(ed => expect(listWindowLeaves(ed.windowLayout).length).toBe(2))
    .done()
})
