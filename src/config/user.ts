import type { Editor } from "../kernel/editor"

/** Local user hook loaded after built-in config. */
export function installUserConfig(editor: Editor): void {
  void editor
}
