import { registerClient } from "../client"
import { stdioConnection } from "../stdio"

/** yaml-language-server for yaml-ts-mode hook in ~/.emacs.d/stephen.el. */
export function registerYamlLanguageServerClient(): void {
  registerClient({
    serverId: "yaml-language-server",
    majorModes: ["yaml"],
    priority: 10,
    languageId: () => "yaml",
    newConnection: stdioConnection(
      ["yaml-language-server", "--stdio"],
      () => Bun.which("yaml-language-server") != null,
    ),
  })
}
