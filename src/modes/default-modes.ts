import { defineMode } from "./mode"

export function installDefaultModes(): void {
  defineMode({ name: "text" })
  defineMode({ name: "markdown" })
  defineMode({ name: "json" })
  defineMode({ name: "javascript", commentStart: "//" })
  defineMode({ name: "typescript", commentStart: "//" })
}
