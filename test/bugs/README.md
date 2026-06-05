# Bug repros

One file per TODO.md bug: `<NN>-<slug>.test.ts`. Each test uses `test.failing(...)` so the suite stays green while the bug exists; when the bug is fixed the test goes red and you flip it to `test(...)`.

Use `test/harness/` — `script()` for buffer/editor state, `keySeq()` for real key dispatch, `fakeLspServer()` for LSP, `displayRows()`/`spans()` for layer-2, `tuiProbe()` for layer-3.

Keep each repro under ~15 lines. The point is to pin behavior, not document the bug — TODO.md does that.
