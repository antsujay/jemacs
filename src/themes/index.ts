import type { Theme } from "../display/theme"
import { gruvboxDarkHardTheme } from "./gruvbox-dark-hard"
import { jemacsDarkTheme } from "./jemacs-dark"

export { gruvboxDarkHardPalette, gruvboxDarkHardTheme } from "./gruvbox-dark-hard"
export { jemacsDarkTheme } from "./jemacs-dark"

/** Built-in themes keyed by name (for `load-theme` and config). */
export const builtinThemes: Record<string, Theme> = {
  [jemacsDarkTheme.name]: jemacsDarkTheme,
  [gruvboxDarkHardTheme.name]: gruvboxDarkHardTheme,
}

export function getBuiltinTheme(name: string): Theme | undefined {
  return builtinThemes[name]
}

/** Default when no user theme is configured. */
export const defaultTheme = jemacsDarkTheme
