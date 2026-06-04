import { registerClient } from "../client"
import { stdioConnection } from "../stdio"

/** typescript-language-server for js-ts-mode / typescript-ts-mode hooks in ~/.emacs.d/stephen.el. */
export function registerTypescriptLanguageServerClient(): void {
  registerClient({
    serverId: "typescript-language-server",
    majorModes: ["javascript", "typescript"],
    priority: 10,
    languageId: buffer => (buffer.mode === "typescript" ? "typescript" : "javascript"),
    newConnection: stdioConnection(
      ["typescript-language-server", "--stdio"],
      () => Bun.which("typescript-language-server") != null,
    ),
  })
}
