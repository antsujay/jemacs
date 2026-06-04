import { registerClient } from "../client"
import { stdioConnection } from "../stdio"

/** gopls for go-mode (see `lsp-mode` + `go-mode` hook in ~/.emacs.d/stephen.el). */
export function registerGoplsClient(): void {
  registerClient({
    serverId: "gopls",
    majorModes: ["go"],
    priority: 10,
    languageId: () => "go",
    newConnection: stdioConnection(["gopls"], () => Bun.which("gopls") != null),
    initializationOptions: {
      staticcheck: true,
    },
  })
}
