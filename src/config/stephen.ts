import type { Editor } from "../kernel/editor"
import { getMode } from "../modes/mode"
import { enableBuiltinTheme } from "../themes"
import { gruvboxDarkHardTheme, install as installGruvboxDarkHardTheme } from "../../plugins/gruvbox-dark-hard"
import { install as installVertico } from "../../plugins/vertico"

const packageBackedCommands = [
  "git-link",
  "magit-find-main",
  "projectile-command-map",
  "ace-jump-word-mode",
  "ace-jump-char-mode",
  "yafolding-toggle-element",
  "gptel-menu",
  "gptel",
  "restart-emacs",
]

export function installStephenConfig(editor: Editor): void {
  installGruvboxDarkHardTheme(editor)
  enableBuiltinTheme(gruvboxDarkHardTheme.name)
  editor.setTheme(gruvboxDarkHardTheme)
  installVertico(editor)
  editor.enableMinorMode("linum-mode")
  editor.enableMinorMode("vertico-mode")

  bindStephenKeys(editor)
  installStephenCommands(editor)
}

function bindStephenKeys(editor: Editor): void {
  editor.key("C-c g l", "git-link")
  editor.key("C-c g m", "magit-find-main")
  editor.key("C-c p", "projectile-command-map")
  editor.key("C-c SPC", "ace-jump-word-mode")
  editor.key("C-c C-x SPC", "ace-jump-char-mode")
  editor.key("C-c RET", "yafolding-toggle-element")
  editor.key("C-c t", "lsp-find-definition")
  editor.key("C-c C-t", "lsp-ui-peek-find-implementation")
  editor.key("C-x C-a", "lsp-execute-code-action")
  editor.key("C-\\", "tiling-cycle")
  editor.key("s-f", "counsel-ag")
  editor.key("s-m", "gptel-menu")
  editor.key("s-g", "gptel")
  editor.key("s-r", "restart-emacs")

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

  for (const command of packageBackedCommands) {
    if (!editor.commands.get(command)) {
      editor.command(command, ({ editor }) => editor.message(`${command} is a package-backed command placeholder in Jemacs.`), `${command} package placeholder.`)
    }
  }
}
