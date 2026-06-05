import { defineMinorMode } from "./minor-mode"

export function installIvyMode(): void {
  defineMinorMode({
    name: "ivy-mode",
    lighter: " Ivy",
    global: true,
  })
}
