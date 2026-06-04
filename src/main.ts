import { Editor } from "./kernel/editor"
import { installDefaultConfig, installDefaultHooks } from "./config"
import { installDefaultModes } from "./modes/default-modes"
import { installMarkdownMode } from "./modes/markdown"
import { installLspMode } from "./lsp/install"
import { installXref } from "./xref/install"
import { runJemacs } from "./run"
import { createDefaultHost } from "./ui/select-host"

async function main(): Promise<void> {
  installDefaultModes()
  const editor = new Editor()
  installMarkdownMode(editor)
  installDefaultConfig(editor)
  installLspMode(editor)
  installDefaultHooks(editor)
  installXref(editor)

  const file = Bun.argv.find((arg, i) => i >= 2 && !arg.startsWith("-") && arg !== "--gui")
  if (file) await editor.openFile(file)

  await runJemacs(editor, createDefaultHost())
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
