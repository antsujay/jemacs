import { registerGoplsClient } from "./gopls"
import { registerPylspClient } from "./pylsp"
import { registerRustAnalyzerClient } from "./rust-analyzer"
import { registerTypescriptLanguageServerClient } from "./typescript"
import { registerYamlLanguageServerClient } from "./yaml"

/** All language servers enabled via lsp-mode hooks in ~/.emacs.d/stephen.el. */
export function registerAllLspClients(): void {
  registerPylspClient()
  registerGoplsClient()
  registerTypescriptLanguageServerClient()
  registerRustAnalyzerClient()
  registerYamlLanguageServerClient()
}
