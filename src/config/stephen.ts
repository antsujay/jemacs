import type { Editor } from "../kernel/editor"
import { getMode } from "../modes/mode"
import { setFaceAttribute } from "../runtime/faces"
import { enableBuiltinTheme } from "../themes"
import { gruvboxDarkHardTheme, install as installGruvboxDarkHardTheme } from "../../plugins/gruvbox-dark-hard"
import { install as installVertico } from "../../plugins/vertico"
import { install as installTiling } from "../../plugins/tiling"
import { install as installWindow } from "../../plugins/window"

export function installStephenConfig(editor: Editor): void {
  installGruvboxDarkHardTheme(editor)
  enableBuiltinTheme(gruvboxDarkHardTheme.name)
  setFaceAttribute("default", "family", "Fira Code")
  setFaceAttribute("default", "height", 140)
  editor.setTheme(gruvboxDarkHardTheme)
  installVertico(editor)
  installWindow(editor)
  installTiling(editor)
  editor.enableMinorMode("linum-mode")
  editor.enableMinorMode("vertico-mode")

  bindStephenKeys(editor)
  installStephenCommands(editor)
}

function bindStephenKeys(editor: Editor): void {
  editor.key("C-c t", "lsp-find-definition")
  editor.key("C-c C-t", "lsp-ui-peek-find-implementation")
  editor.key("C-x C-a", "lsp-execute-code-action")
  editor.key("s-f", "counsel-ag")
  editor.key("s-=", "text-scale-adjust")

  getMode("protobuf")?.keymap?.bind("C-c n", "proto-renumber")
}

function installStephenCommands(editor: Editor): void {
  editor.command("proto-renumber", ({ buffer }) => {
    let next = 1
    buffer.setText(buffer.text.replace(/=\s*\d+(\s*;)/g, () => `= ${next++};`), true)
  }, "Renumber protobuf field tags in the region or buffer.")

  editor.command("proto-add-rpc", ({ buffer, args }) => {
    const name = args[0] ?? "NewRpc"
    const line = `  rpc ${name}(${name}Request) returns (${name}Response);\n`
    buffer.insert(line)
  }, "Insert a protobuf service RPC declaration.")
}
