import type { Editor } from "../../src/kernel/editor"
import { install as installStephenFixture } from "./stephen-config"
import { install as installProjectile } from "../../../jemacs-packages/projectile/projectile"
import { install as installCompile } from "../../plugins/compile"
import { install as installNextError } from "../../plugins/next-error"
import { install as installPersist } from "../../plugins/persist"

/** Stephen-like fixture plus projectile package (C-c p). */
export async function install(editor: Editor): Promise<void> {
  await installStephenFixture(editor)
  installCompile(editor)
  installNextError(editor)
  installPersist(editor)
  await installProjectile(editor)
}
