# Jemacs workspace packages

Organizational split for a future publishable monorepo. The app entrypoints still live at the repo root (`src/main.ts`); these packages re-export the same modules.

| Package | Role |
| --- | --- |
| `@jemacs/core` | Kernel, `display/`, `runJemacs` |
| `@jemacs/host-opentui` | `OpenTuiHost`, host selection |
| `@jemacs/host-electron` | `ElectronHost`, shared `dom-frame` |
