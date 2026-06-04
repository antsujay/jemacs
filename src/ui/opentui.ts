/** Re-exports for tests and backward compatibility. Runtime uses OpenTuiHost via runJemacs. */
export {
  visibleStyledText,
  visibleStyledTextFromStart,
} from "../display/buffer-view"
export {
  visibleText,
  visibleTextRegion,
  visibleTextRegionFromStart,
  pageScrollLines,
  contentAreaLines,
  windowBodyLines,
  defaultTerminalRows,
} from "../display/viewport"
export { OpenTuiHost } from "./opentui-host"
export { startOpenTui } from "./opentui-legacy"
