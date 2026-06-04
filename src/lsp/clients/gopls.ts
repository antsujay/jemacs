import { registerClient } from "../client"
import { serverBinaryAvailable } from "../server-path"
import { stdioConnection } from "../stdio"

/** gopls for go-mode (see `lsp-mode` + `go-mode` hook in ~/.emacs.d/stephen.el). */
export function registerGoplsClient(): void {
  registerClient({
    serverId: "gopls",
    majorModes: ["go"],
    priority: 10,
    languageId: () => "go",
    newConnection: stdioConnection(["gopls"], () => serverBinaryAvailable("gopls")),
    initializationOptions: {
      staticcheck: true,
    },
  })
}
