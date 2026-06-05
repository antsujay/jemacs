# src/display/

Pure render: `Editor` → `DisplayModel`. Hosts (`src/ui/`) consume `DisplayModel`; they never read `Editor` directly.

| file | what |
|---|---|
| `protocol.ts` | `DisplayModel`, `WindowDisplayNode`, `UiHost` — the contract a new host implements |
| `build-display-model.ts` | `buildDisplayModel(editor, {viewport})` — the one entry point |
| `buffer-view.ts` | `styledRegion` — text + spans → `ThemedText`; handles cursor insertion, line numbers, region |
| `themed-text.ts`, `theme.ts` | `ThemedText{chunks}`, face → fg/bg/bold |
| `viewport.ts`, `click-to-point.ts` | scroll math, cell→point |

`buildDisplayModel` must be pure (no `editor` mutation). Test at layer 2 via `test/harness/display.ts`.
