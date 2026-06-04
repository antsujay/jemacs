import { registerClient } from "../client"
import { serverBinaryAvailable } from "../server-path"
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
      () => serverBinaryAvailable("yaml-language-server"),
    ),
  })
}
