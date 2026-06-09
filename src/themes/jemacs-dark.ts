import { defineTheme } from "../display/theme"
import { FIXED_PITCH_FAMILY } from "../runtime/faces"

/** Built-in VS Code–inspired dark palette (not Gruvbox). */
export const jemacsDarkTheme = defineTheme("jemacs-dark", {
  default: { fg: "#d4d4d4", bg: "#1e1e1e", family: FIXED_PITCH_FAMILY },
  keyword: { fg: "#569cd6", bold: true },
  string: { fg: "#ce9178" },
  comment: { fg: "#6a9955", italic: true },
  builtin: { fg: "#4ec9b0" },
  function: { fg: "#dcdcaa" },
  type: { fg: "#4ec9b0" },
  number: { fg: "#b5cea8" },
  constant: { fg: "#9cdcfe" },
  directory: { fg: "#4fc1ff", bold: true },
  region: { bg: "#3f4756" },
  isearch: { bg: "#6a5f00", fg: "#ffffff" },
  lazyHighlight: { bg: "#3a3a5a" },
  modeLine: { fg: "#ffffff", bg: "#264f78", bold: true },
  modeLineInactive: { fg: "#9d9d9d", bg: "#252526" },
  minibuffer: { fg: "#ffffff", bg: "#3a3a3a" },
  minibufferPrompt: { fg: "#4ec9b0", bold: true },
  title: { fg: "#cccccc", bg: "#1e1e1e" },
  // Underline only — must layer over font-lock fg, not repaint it (t-1f96245b).
  error: { underline: true },
  lineNumber: { fg: "#6e7681", bg: "#161b22", italic: true },
  lineNumberCurrent: { fg: "#d4d4d4", bg: "#161b22", italic: true },
})
