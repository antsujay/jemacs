import type { UiHost } from "../display/protocol"
import { OpenTuiHost } from "./opentui-host"

export function wantsGuiHost(argv: string[] = Bun.argv): boolean {
  return argv.includes("--gui") || process.env.JEMACS_UI === "electron"
}

/** Load Electron only when requested — static `electron` imports break `bun run dev` (TUI). */
export async function createDefaultHost(): Promise<UiHost> {
  if (wantsGuiHost()) {
    const { ElectronHost } = await import("./electron-host")
    return new ElectronHost()
  }
  return new OpenTuiHost()
}
