import type { Editor } from "../src/kernel/editor"

export function install(editor: Editor): void {
  editor.command("demo-hello", ({ editor }) => {
    editor.scratch("*demo*", "Hello from a live-loaded plugin.\n\nEdit plugins/demo-plugin.ts and reload it with Ctrl-C Ctrl-L.", "text")
  }, "Open a demo plugin buffer.")

  editor.key("C-c h", "demo-hello")
  editor.message("demo-plugin installed: try C-c h")
}
