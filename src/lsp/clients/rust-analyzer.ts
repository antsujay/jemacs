import { registerClient } from "../client"
import { stdioConnection } from "../stdio"

/** rust-analyzer for rust-ts-mode / rust-mode (lsp-rust-server in ~/.emacs.d/stephen.el). */
export function registerRustAnalyzerClient(): void {
  registerClient({
    serverId: "rust-analyzer",
    majorModes: ["rust"],
    priority: 10,
    languageId: () => "rust",
    newConnection: stdioConnection(["rust-analyzer"], () => Bun.which("rust-analyzer") != null),
  })
}
