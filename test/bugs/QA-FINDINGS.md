# QA findings — tui-drive scenarios, 2026-06-05

Driven via `scripts/tui-drive.sh` (tmux 3.6a, 120×35, bun 1.3.13). Each entry: file → key sequence → observed vs expected → severity. Example files were restored with `git checkout` after each scenario.

---

## CRITICAL

### C1. Burst self-insert inserts N copies of the *last* char
- **File:** `examples/py-pkg/mylib/__init__.py` (reproduces in any buffer)
- **Keys:** `C-e` then send `"abcXYZ"` as one literal chunk (paste / `tmux send-keys -l`)
- **Observed:** buffer gets `ZZZZZZ`. `"def123"` → `333333`. `"  HELLO"` → `OOOOOOO`. Sending the same chars one-at-a-time (`q`, `w`, `e`) inserts `qwe` correctly.
- **Expected:** the literal string is inserted.
- **Notes:** isearch/minibuffer input is *not* affected (`C-s` + `"Counter"` searches for `Counter`), so key delivery is fine — the bug is in `self-insert-command` reading the *latest* event for every queued event in a tick (closure over shared mutable key state). Any paste into a main buffer is corrupted.
- **Severity:** CRITICAL

### C2. `markdown-insert-link` throws and leaves buffer half-mutated
- **File:** `examples/docs/guide.md`
- **Keys:** `C-c C-l`
- **Observed:** `TypeError: this.adjustMark is not a function` at `src/kernel/buffer.ts:71` via `wrapOrInsert` (`src/modes/markdown.ts:303`). Point jumped col 1→17, so partial insertion happened before the throw. Stack trace floods echo area; editor stays alive.
- **Expected:** prompt for URL/text, insert `[text](url)`.
- **Severity:** CRITICAL

### C3. `switch-to-buffer` on unknown name throws instead of creating buffer
- **File:** `examples/ts-app/src/index.ts`
- **Keys:** `C-x b` `zzz` `RET`
- **Observed:** `Error: No such buffer: index.tszzz` + 8-line stack trace in echo area (`src/kernel/editor.ts:320`).
- **Expected:** create a fresh empty buffer named `index.tszzz` (Emacs behaviour), or at minimum a one-line message — never a raw stack trace.
- **Severity:** CRITICAL

---

## HIGH

### H1. Meta + certain punctuation arrives as empty/unrecognized key in terminal
- **File:** `examples/rust-lib/src/lib.rs`, `examples/py-pkg/mylib/__init__.py`, `examples/docs/guide.md`
- **Keys:** `M-.` `M-<` `M->` `M-{` `M-}`
- **Observed:** echo area shows `Unbound key:` with an **empty** token; point does not move. The commands *are* bound (`xref-find-definitions`, `beginning/end-of-buffer`, `forward/backward-paragraph`). `M-;` `M-m` `M-w` `M-n` `M-f` work, so it's specific to `. < > { }`. `esc .` works (explicit `esc .` binding exists) — confirms the binding is installed; only the Alt-chord normalization is broken. Likely related to existing `test/bugs/10-shifted-punct-meta-gt.test.ts` but `M-.` (unshifted period) is also affected.
- **Expected:** dispatch to the bound command.
- **Severity:** HIGH

### H2. `C-h` dispatches `delete-backward-char`, not the help prefix
- **File:** `examples/rust-lib/src/lib.rs`
- **Keys:** at line 2 eol: `C-h k`
- **Observed:** the `{` before point is deleted, then `k` self-inserts. All `C-h …` chords (`C-h k`, `C-h b`, `C-h f`, `C-h e`, …) are unreachable in the terminal. OpenTUI delivers Ctrl+H as `backspace` (ASCII 0x08) and the `backspace → delete-backward-char` binding wins before the `C-h …` prefix is considered.
- **Expected:** `C-h` is a prefix; `C-h k` runs `describe-key`.
- **Severity:** HIGH

### H3. `find-file` prefills directory **without** trailing `/`
- **File:** `examples/ts-app/src/index.ts`
- **Keys:** `C-x C-f`
- **Observed:** prompt is `Find file: …/examples/ts-app/src█`. Typing `exa` yields `…/ts-app/srcexa`. Fido shows zero candidates (path doesn't exist), `C-n`/`C-p` do nothing, `RET` opens a bogus new buffer `srcexa` in `text` mode.
- **Expected:** prompt prefills `…/ts-app/src/` so typing a name produces `…/src/exa…` and fido lists siblings.
- **Severity:** HIGH

### H4. `switch-to-buffer` prefills *current* buffer name as editable text
- **File:** `examples/ts-app/src/index.ts`
- **Keys:** `C-x b` then type `ind`
- **Observed:** prompt is `Switch to buffer: index.ts█`; typing appends → `index.tsind`, fido reports `[No match]`, `C-n`/`C-p` are no-ops.
- **Expected:** default (the *other* buffer) shown as a hint, input starts empty so typing filters the buffer list. Same prefill-as-text-not-as-default issue as H3.
- **Severity:** HIGH

### H5. `next-line` does not preserve goal column
- **File:** `examples/rust-lib/src/lib.rs`
- **Keys:** `C-n C-n C-e` (→ line 3 col 36), then `C-n` ×6
- **Observed:** col sequence `36 → 2 → 1 → 1 → 1 → 1 → 1`. Once a short/blank line clamps the column, it never recovers.
- **Expected:** goal column 36 is remembered; on line 7 (`pub struct Counter…`, len 32) point lands at col 32, on line 9 (`impl Counter {`, len 15) at col 15, etc.
- **Severity:** HIGH (core motion fidelity)

---

## MEDIUM

### M1. `comment-dwim` uses `-- ` in rust-mode (and inserts at point, not EOL)
- **File:** `examples/rust-lib/src/lib.rs`
- **Keys:** point on line 10 col 9 (`fn`), `M-;`
- **Observed:** line becomes `    pub --fn new() …`. Wrong comment leader (`--` is SQL/Lua/Ada; rust is `//`), and inserted mid-line at point.
- **Expected:** append `  // ` at end of line and move point there (no region active).
- **Severity:** MEDIUM

### M2. `isearch-forward` leaves point at *start* of match
- **File:** `examples/rust-lib/src/lib.rs`
- **Keys:** from line 1 col 1, `C-s fold RET`
- **Observed:** point at line 1 col 21 (the `f` in `fold`). Same for `C-s Counter` (line 7 col 12) and `C-M-s fn \w+` (line 10 col 9).
- **Expected:** forward isearch leaves point *after* the match (col 25 / 19 / 15 respectively). Breaks `C-s C-s` repeat semantics.
- **Severity:** MEDIUM

### M3. `TAB` on a markdown heading indents the heading
- **File:** `examples/docs/guide.md`
- **Keys:** point on line 1 (`# Guide`), `TAB`
- **Observed:** line becomes `    # Guide`, buffer dirty.
- **Expected:** `markdown-cycle` on a heading line cycles outline visibility (or at minimum is a no-op). Indenting an ATX heading turns it into a code block — never desirable.
- **Severity:** MEDIUM

### M4. `ESC` is not a universal Meta prefix
- **File:** `examples/py-pkg/mylib/__init__.py`
- **Keys:** `ESC }` (no explicit `esc }` binding in python-mode)
- **Observed:** `}` self-inserts (col 1→2, buffer dirty). Only chords with an *explicit* `esc X` binding work (`esc .`, `esc f`, markdown-mode's `esc }`). Combined with H1, `forward-paragraph` / `beginning-of-buffer` are unreachable from the terminal in non-markdown buffers except via `M-x`.
- **Expected:** `ESC <key>` falls through to the `M-<key>` binding when no explicit `esc <key>` exists.
- **Severity:** MEDIUM

### M5. `M-w` / `C-y` don't update mark
- **File:** `examples/py-pkg/mylib/__init__.py`
- **Keys:** `C-SPC C-n C-n M-w C-y`
- **Observed:** modeline shows `mark=1` throughout — unchanged after `M-w` (should deactivate transient mark) and after `C-y` (should set mark to start of yanked text so `C-x C-x` reselects it).
- **Expected:** `M-w` deactivates mark; `C-y` sets mark at the beginning of the inserted region.
- **Severity:** MEDIUM (overlaps `15-mark-not-adjusted` for the insert side)

---

## LOW

### L1. "Unbound key:" diagnostic shows empty token
- **Keys:** any of the H1 chords
- **Observed:** `Unbound key:` followed by nothing.
- **Expected:** show the normalized token (or raw bytes) so the user can tell *what* arrived. `src/kernel/editor.ts:548`.
- **Severity:** LOW

### L2. Echo area not cleared on next successful command
- **File:** `examples/docs/guide.md`
- **Keys:** `M-}` (fails → `Unbound key:`), then `ESC }` (succeeds, point moves)
- **Observed:** stale `Unbound key:` still displayed after the successful motion.
- **Expected:** echo cleared (or replaced) on next command.
- **Severity:** LOW

### L3. `split-window-below` gives bottom window a different scroll offset
- **File:** `examples/py-pkg/mylib/__init__.py`
- **Keys:** `C-x 2`
- **Observed:** top window starts at line 1, bottom window starts at line 2.
- **Expected:** both windows show identical viewport immediately after split.
- **Severity:** LOW

---

## Passed (worked as expected)
- `M-m` (back-to-indentation) — line 3 → col 5 ✓
- `C-e`, `C-a`, `C-n`, `C-p` basic motion ✓
- `esc .` → `xref-find-definitions` jumped `impl Counter` → `struct Counter` via rust-analyzer ✓
- `C-s` / `C-M-s` open isearch / regexp isearch and find matches ✓ (modulo M2 point placement)
- `C-x C-s` saves and clears the `*` flag ✓
- `C-SPC` / `M-w` / `C-y` round-trip content correctly ✓ (modulo M5 mark state)
- `M-n` `flymake-goto-next-error` bound and reports "No more Flymake diagnostics" ✓ (no python LSP attached, so no diagnostics to navigate — informational only)
- `C-x 2` / `C-x o` split and cycle focus; edits reflect in both panes ✓
- markdown-mode `esc }` / `esc {` paragraph motion ✓
- `M-x` opens extended-command prompt ✓
- mode detection: `rust`, `python`, `typescript`, `markdown` all correct in modeline ✓
