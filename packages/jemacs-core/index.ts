// Public surface of @jemacs/core. Hand-curated; keep in sync with README.md
// ("the full runtime — src/runtime/jemacs-runtime.ts"), DESIGN.md (PluginContext),
// and packages/README.md ("Kernel, display/, runJemacs").

// Kernel — state holders + dispatch.
export * from "../../src/kernel/editor"
export * from "../../src/kernel/buffer"
export * from "../../src/kernel/keymap"
export * from "../../src/kernel/command"
export * from "../../src/kernel/window"
export * from "../../src/kernel/hooks"

// Display — host-agnostic model + UiHost protocol.
export * from "../../src/display/protocol"
export * from "../../src/display/build-display-model"

// Runtime — the documented eval/plugin surface (defcustom, defineMode, addHook,
// addAdvice, …) plus the per-plugin disposable registration context.
export * from "../../src/runtime/jemacs-runtime"
export { createPluginContext, type PluginContext } from "../../src/runtime/plugin-context"

// Bootstrap — runJemacs / bindJemacsHost.
export * from "../../src/run"
