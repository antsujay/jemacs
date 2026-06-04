import type { UiHost } from "../display/protocol"
import { OpenTuiHost } from "./opentui-host"

/** OpenTUI-only input wiring (kept out of `run.ts` so Electron main does not bundle `@opentui/core`). */
export async function attachOpenTuiInput(host: UiHost): Promise<void> {
  if (!(host instanceof OpenTuiHost)) return
  host.attachInput(host.getRenderer())
  host.attachMouse()
}
