import { defface } from "../runtime/faces"
import { jemacsDarkTheme } from "../themes/jemacs-dark"

/** Register baseline face specs from the default theme (Emacs `defface` analogue). */
export function installDefaultFaces(): void {
  for (const [name, spec] of Object.entries(jemacsDarkTheme.faces)) {
    if (spec) defface(name, spec)
  }
}
