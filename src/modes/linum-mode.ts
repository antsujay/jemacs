import { defineMinorMode } from "./minor-mode"

export function installLinumMode(): void {
  defineMinorMode({
    name: "linum-mode",
    lighter: " Lin",
    global: true,
  })
}
