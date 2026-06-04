import type { UiHost } from "../display/protocol"
import { ElectronHost } from "./electron-host"
import { OpenTuiHost } from "./opentui-host"

export function wantsGuiHost(argv: string[] = Bun.argv): boolean {
  return argv.includes("--gui") || process.env.JEMACS_UI === "electron"
}

export function createDefaultHost(): UiHost {
  return wantsGuiHost() ? new ElectronHost() : new OpenTuiHost()
}
