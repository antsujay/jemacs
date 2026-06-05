# test/

| dir | what |
|---|---|
| `harness/` | `script()` fluent DSL, `keySeq()`, `fakeLspServer()`, `displayRows()`, `tuiProbe()` |
| `bugs/` | one `test.failing()` per known bug; flip to `test()` when fixed |
| `plugins/` | one file per plugin |
| (root `*.test.ts`) | kernel/display/lsp originals |

Three layers (`.claude/skills/qa/`): kernel via `script()/handleKey`; DisplayModel via `displayRows()/spans()`; real terminal via `tuiProbe()` (slow — sparingly).

`bun test` for the suite; `bun test test/bugs/NN-*` for one repro.
