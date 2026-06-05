# Roadmap: jemacs → daily driver

Derived from a real-world Emacs `post-command-hook` log + a full inventory
of `src/`. Priorities are ordered by observed command frequency, not
generic feature parity.

---

Each is `plugins/<name>/index.ts` exporting `install(editor)`. Loaded in
order from `plugins/builtin.ts`, called by `installDefaultConfig` after
defaults. `$EL` = `~/src/emacs-lisp` (symlink to Emacs 30.2 lisp dir, files
are `.el.gz`); `$STRAIGHT` = `~/.emacs.d/straight/repos`.

| plugin | adds | src/ change? | elisp reference |
|---|---|---|---|
| `motion` | `back-to-indentation`, `M-{`/`M-}`, `transpose-words`/`-lines` | — | `$EL/simple.el.gz:1075,8650,8716,8737`; `$EL/textmodes/paragraphs.el.gz` |
| `mark-ring` | per-buffer 16-ring, `C-u C-SPC`, global ring | — | `$EL/simple.el.gz:7281-7290` |
| `save-hooks` | fire `before-/after-save-hook`; `delete-trailing-whitespace` | — | `$EL/files.el.gz` (`basic-save-buffer`); `$EL/simple.el.gz:846` |
| `comment-dwim` | `M-;` | — | `$EL/newcomment.el.gz` |
| `next-error` | location-list + `M-g n`/`p`; rewire `*grep*` | — | `$EL/simple.el.gz:338`; `$EL/progmodes/compile.el.gz`, `grep.el.gz` |
| `flymake-nav` | `M-n`/`M-p` over diagnostics | — | `$EL/progmodes/flymake.el.gz:1362` |
| `windmove` | `S-<arrow>` | — | `$EL/windmove.el.gz` |
| `electric-pair` | pair-insert minor mode | — | `$EL/elec-pair.el.gz` |
| `show-paren` | match highlight minor mode | — | `$EL/paren.el.gz` |
| `subword` | camelCase word motion | `buffer.ts` reads `word-regexp` defcustom | `$EL/progmodes/subword.el.gz` |
| `isearch-regexp` | `C-M-s`, smart case | — | `$EL/isearch.el.gz` |
| `persist` | savehist + recentf + idle-timer | — | `$EL/savehist.el.gz`, `$EL/recentf.el.gz`, `$EL/emacs-lisp/timer.el.gz` |
| `fido` | vertical fuzzy completion | `Completer` delegate in `editor.prompt` | `$EL/icomplete.el.gz:402,462,709`; `$EL/minibuffer.el.gz:4184,4589-4623` |
| `term` | pty `*term*` buffer | maybe `host.writeRaw` | `$EL/term.el.gz` (`term-emulate-terminal`) |
| `auto-revert` | `fs.watch` → revert | — | `$EL/autorevert.el.gz` |
| `lsp-extras` | hover, rename, references | — | `$EL/progmodes/eglot.el.gz:3092,3403,3499,3722` |
| `lsp-monorepo` | ra-multiplex + RA initOpts + drop `$/progress` | — | eglot config: `eglot-server-programs`, `eglot-workspace-configuration` |
| `lsp-watchman` | watchman poll → `didChangeWatchedFiles` | — | `eglot-register-capability` override; see plugin source comments |
| `mcp-server` | stdio MCP exposing describe-* | — | `$STRAIGHT/elisp-dev-mcp/elisp-dev-mcp.el`, `$STRAIGHT/mcp-server-lib.el/` |

Prereq PR (in `src/`): fix `recenter` viewport semantics; add
`word-regexp` defcustom in `buffer.ts:150`; add `Completer` delegate hook
in `editor.completingRead`.

## Long-term: remote architecture (laptop UI ↔ remote dev box daemon)

Target: editor daemon on the remote, native UI on the laptop, feels local at
100+ms RTT with frequent disconnects. Emacs has no story here ("emacsclient
tells the *server* to open a frame on *its* display"); jemacs can because
`DisplayModel` is already serializable and the kernel runs on both sides.

**Model — shadow kernel with rollback (GGPO-style), SSP transport (Mosh-style):**

- Server: full `Editor`, authoritative. Daemon survives disconnects.
- Client: a *second* `Editor` running the same kernel, with `fs`/`spawn`/`lsp`
  stubbed to "return immediately, mark pending-server". On keystroke: client
  `handleKey` runs locally (instant render), key shipped to server with seq.
  Server runs `handleKey`, ships back `(seq, state-diff)`. Client compares its
  state at `seq` — match → confirm; diverge → snap to server state + replay
  unconfirmed inputs. The predictable subset of `handleKey` (everything sync —
  motion, self-insert, kill/yank, window ops) is already deterministic, so
  divergence only happens on I/O-touching commands.
- Wire: SSP — server diffs against last *ack'd* state, not last sent. Lost
  frames don't accumulate. Heartbeat = monotone seq; gap → "(reconnecting…)"
  while client keeps predicting. WebSocket over the existing ssh ControlMaster.

**Prereqs (in order):**

1. `DisplayModel` row-diff codec (`display/diff.ts`). Most keystrokes touch
   1-2 rows + modeline.
2. `Editor` state-diff: serialize/patch `{buffers, windowLayout, point/mark,
   minibuffer}`. Start with full-buffer-text-on-open; rope/op-log only if
   profiled.
3. I/O stub layer: `RemoteFs`/`RemoteSpawn`/`RemoteLsp` that no-op on client
   and proxy to server. The DESIGN.md core/lisp split makes this clean — only
   `kernel/` does I/O, so stubs are a small surface.
4. Determinism audit: no `Date.now()`/`Math.random()` in the sync `handleKey`
   path; idle-timers are server-only.
5. `src/ui/remote-host.ts` (server) + `clients/laptop/` (renderer — Electron
   renderer pointed at `ws://` instead of `ipc`).

**Spike to de-risk first:** remote-host with no prediction → measure baseline
RTT distribution → add level-1 `predict(DisplayModel, key)` for self-insert/
arrows → only then build the shadow kernel.

## Long-term ideas

**i3-style window management.** The binary `WindowNode` tree + `windmove` are
the substrate; i3 adds: layout containers (master-stack / tabbed / stacking
per split node, not just h/v), numbered workspaces (a `workspaces: WindowNode[]`
array with `Mod+N` switch), keyboard resize, scratchpad. The keymap is already
in nostalgia's NOTES.md. ~`plugins/i3/` over the existing tree; the only
kernel change is `WindowNode.layout: "split" | "tabbed" | "stacked"`.

**AI agent natively inside — deeper than chat-in-term.** The agent gets direct
`Editor` access, not a text stream: reads `currentBuffer`/`point`/`mark`/
window-layout, runs `editor.run(cmd)`, edits buffers you're watching. Three
layers: (1) the MCP server (`plugins/mcp-server/` — describe-*, find-function,
run-command); (2) a `post-command-hook` watcher that streams your session to
the agent (the dogfood log is already this); (3) a second "cursor" — the agent
operates on buffers concurrently, with its edits showing as a distinct face,
and you accept/reject hunks like magit. The shadow-kernel rollback work for
remote is the same machinery (two writers, one authoritative).

**Remote, packaged like VSCode Remote-SSH.** The level-2 design above; package
as: `jemacsd` auto-starts via the remote-helper bootstrap pattern from
nostalgia (one persistent `ssh host -- bash -s`, write the daemon-launch loop
to stdin), laptop client has `M-x remote-connect` that port-forwards over
ControlMaster and opens the WS. Crib nostalgia's `safe()` realpath-under-$HOME
boundary and the FZ-on-remote pattern (ship the query, not the file list).

**Rich rendering in TUI.** Images via kitty graphics protocol / sixel
(OpenTUI's Zig core may already emit these — check); markdown rendered (not
just highlighted) with proportional headings via Unicode width tricks; LaTeX
via `tectonic → png → kitty-image`; HTML via a readability-style extractor →
markdown. Ceiling is roughly what `chafa`/`viu`/`glow` do today, but inline in
a buffer with point-addressable regions. Prereq: `DisplayModel` grows an
`image` chunk kind alongside `ThemedText`.

**Electron renderer in browser.** Strict subset of the remote architecture:
same WS wire, but the client is the Electron renderer served over HTTP instead
of bundled. `bun build src/electron/renderer.ts --target browser`, swap the IPC
transport for WS, serve static + `/ws`. Gets you a jemacs you can open from a
phone pointed at the remote dev box.

**Property-based / simulation testing.** Three layers, in leverage order:

1. *Invariant fuzzing on `_splice`.* Generate random `(from, to, repl)`
   sequences against a `BufferModel`, assert the ARCHITECTURE.md invariants
   after each: `0 ≤ point ≤ len`, `mark ∈ [0,len] ∪ null`, `onTextChange`
   delta matches the actual text diff, undo restores exactly. Would have
   caught ~half the round-1 bugs. `test/property/buffer.prop.test.ts` —
   spiked below with an inline LCG; `fast-check` (on npm) is the
   upgrade for shrinking.
2. *Key-sequence fuzz on `handleKey`.* Generate random `KeyEventLike[]`,
   feed through real dispatch, assert: no throw, invariants hold,
   `buildDisplayModel` is pure (call twice → equal). Catches keymap
   normalization, command-state-leak, display bugs. The generator is just
   `{name, ctrl?, meta?, shift?}` over a small alphabet.
3. *Differential vs Emacs.* Same key sequence → jemacs `(text,point,mark)`
   vs `emacs --batch -l test/property/harness.el` → same triple. The
   `compare-*.md` reports found semantic gaps by reading; this finds the
   rest by running. Slow (spawns emacs), so nightly / on-demand.

The determinism audit for remote (no `Date.now`/`Math.random` in sync
`handleKey`) is the *same* prerequisite as (2) — seeded fuzz needs a
deterministic kernel. One audit unlocks both. DST-style: seed → N keys →
state hash; same seed twice → same hash, or you found nondeterminism.

**Really really fast.** Current hot spots: `buffer.text` is a flat string
(every insert is O(n)); `moveLine`/`lineCol` do `split("\n")` per call;
font-lock re-runs the full tree-sitter parse on every keystroke; `setText`
snapshots the whole string for undo. Fixes in order of leverage: (1) line-
offset index on `BufferModel` (Uint32Array of `\n` positions, incrementally
maintained — makes lineCol/moveLine O(log n)); (2) tree-sitter incremental
re-parse (`tree.edit()` + `parser.parse(newText, oldTree)` — the lib already
supports it); (3) piece-table or gap-buffer for `text` (only matters past
~100KB); (4) DisplayModel row-diff so the host repaints 2 rows not 30.
Benchmark harness first: `bench/` with a 10k-line file and a scripted edit
sequence, p99 keystroke→render latency as the metric.

## Suggested first PR set

Ordered to go from "can't use it" → "can use it for an afternoon":

1. `back-to-indentation` + fix `recenter` viewport semantics (1 file, ~30 lines)
2. OSC 52 emit on kill (1 file, ~20 lines)
3. mark-ring + `C-u C-SPC` (buffer.ts + bindings)
4. `before-save-hook` / `after-save-hook` / `post-command-hook` actually fire
5. fido-vertical completion (the big one — new completion-ui module)
6. term-mode via pty
7. watchman LSP file-watch + persistent-LSP client config

After 1–4 it's tolerable; after 5–6 it's daily-drivable for read/nav; after 7
you can edit Rust in large workspaces without rust-analyzer reindexing every connect.
