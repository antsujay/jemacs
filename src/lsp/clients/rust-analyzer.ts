import { registerClient } from "../client"
import { serverBinaryAvailable } from "../server-path"
import { stdioConnection } from "../stdio"

/** rust-analyzer for rust-ts-mode / rust-mode (lsp-rust-server in ~/.emacs.d/stephen.el). */
export function registerRustAnalyzerClient(): void {
  registerClient({
    serverId: "rust-analyzer",
    majorModes: ["rust"],
    priority: 10,
    languageId: () => "rust",
    newConnection: stdioConnection(["rust-analyzer"], () => serverBinaryAvailable("rust-analyzer")),
  })
}
