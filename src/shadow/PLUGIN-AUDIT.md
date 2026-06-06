# Plugin remote-awareness audit

Per `DESIGN.md`: a buffer with `link` set is remote. Plugins that spawn
subprocesses, touch the filesystem, or call `buffer.save()` directly must
either **(a)** route via `{kind:"command"}` to A when `buffer.link` is set,
**(b)** skip remote buffers (A owns it), or **(c)** work unchanged.

No plugin currently checks `buffer.link` — every row below is a gap.

## Gaps

| Plugin | File:Line | What it does | Disposition |
|---|---|---|---|
| **compile** | `compile/index.ts:121,125` | `spawnProcess([sh,-c,cmd])` in `compilationStart`; cwd from `findProjectRoot` (FS walk at :172) | **(a)** — send `{command:"compile",args:[cmd,cwd]}`; A creates `*compilation*` and streams output back as `{kind:"buffer"}` + splice |
| **magit** | `magit/index.ts:34` | `git()` helper: `spawnProcess(["git",...])` for every magit verb (status/stage/commit/push/log); `projectRoot` at :327 walks local FS | **(a)** — send `{command:"magit-status"/"magit-stage"/...}`; A renders `*magit*` and `{kind:"buffer"}`-sends it |
| **project** | `project/index.ts:29` | `spawnProcess(["git","ls-files","-z"])` for `project-find-file` | **(a)** — `{command:"project-find-file"}`; candidate list comes back (or A drives the completing-read) |
| | `project/index.ts:22` | `access()` walk for root markers | **(a)** — covered by routing the command |
| | `project/index.ts:40,53` | read/write `~/.jemacs/projects.json` | **(c)** — known-projects list is S-side state; keep local |
| **next-error** | `next-error/index.ts:157` | `counsel-ag`: `spawnProcess(["rg",...])`; cwd from `findProjectRoot` | **(a)** — `{command:"counsel-ag",args:[pattern]}` |
| | `next-error/index.ts:74` | `editor.openFile(loc.file)` to visit error location | **(a)** — when origin buffer is remote, the path is A-side; needs link-aware `openFile` |
| **term-v2** | `term-v2/index.ts:243` | `spawnPty([shell,"-i"])` (via `term/pty.ts:29` `Bun.spawn`) | **(a)** — pty lives on A; `term-send-raw` → `{command}`; output → splice (per DESIGN) |
| **term** | `term/pty.ts:29` | `Bun.spawn` (pty backend, re-exported by term-v2) | **(a)** — same as term-v2 |
| **wdired** | `wdired/index.ts:178,180` | `mkdir`/`rename` on dired entries at `wdired-finish-edit` | **(a)** — `{command:"wdired-finish-edit",args:[renames]}` (dired buffer's dir is A-side) |
| **auto-revert** | `auto-revert/index.ts:63` | `fs.watch(buffer.path)` on `find-file-hook` | **(b)** — skip when `buffer.link`; A pushes content changes as splice/buffer ops, which *is* the revert |
| | `auto-revert/index.ts:32-33` | `fileExists`/`readFileText(buffer.path)` in `revert` | **(b)** — same |
| **auto-save** | `auto-save/index.ts:19,27` | `editor.doAutoSave()` writes `#file#` to local FS on timer + keystroke count | **(b)** — skip remote buffers; A owns persistence (per DESIGN) |
| | `auto-save/index.ts:37-38` | `stat(autoSave)` / `stat(buffer.path)` on `find-file-hook` | **(b)** — skip when `buffer.link` |
| **persist** | `persist/index.ts:224` | `recentf` records `buffer.path` on `find-file-hook` | **(b)** — per DESIGN "persist: skip remote buffers". (Recording remote paths in S's recentf is harmless, but `recentf-open` at :268 → `editor.openFile` would then need link routing — simpler to skip.) |
| | `persist/index.ts:144,149,188,193` | savehist/recentf read/write `~/.jemacs/*.json` | **(c)** — S-side editor state, stays local |
| **lsp-monorepo** | `lsp-monorepo/index.ts:51,59,66` | spawns `ra-multiplex status`/`server` at install; `registerClient` with `stdioConnection` | **(b)** — A runs LSP servers; on S `editor.lsp` is a stub, so skip server bring-up entirely on the shadow side |
| **lsp-watchman** | `lsp-watchman/index.ts:105` | spawns `watchman -j` to feed `workspace/didChangeWatchedFiles` into `ws.rpc` (:140) | **(b)** — A owns FS + LSP; skip on shadow |
| **lsp-extras** | `lsp-extras/index.ts:121,145,173` | `ws.rpc.request("textDocument/hover"/"rename"/"references")` — bypasses any `editor.lsp` stub | **(a)** — go through the lsp stub or `{command:"lsp-hover"/"lsp-rename"/"xref-find-references"}`; resolve on `{kind:"lsp"}` |
| | `lsp-extras/index.ts:83` | `editor.openFile(path)` to apply workspace edits in unopened files | **(a)** — needs link-aware `openFile` |
| **eldoc** | `eldoc/index.ts:51` | `ws.rpc.request("textDocument/hover")` directly | **(a)** — route via lsp stub / `{command:"lsp-hover"}` |
| **lean4** | `lean4/index.ts:66` | `ws.rpc.request("$/lean/plainGoal")` directly | **(a)** — route via lsp stub / `{command:"lean-plain-goal"}` |
| **vertico** | `vertico.ts:120` | `fileCompletionCandidates(input, cwd)` — readdir of local FS for `find-file` completion | **(a)** — when the prompting command targets a remote buffer, completion must list A's FS; really an `editor.prompt`/`find-file` concern but vertico calls the helper directly |
| **markdown** | `markdown/index.ts:881` | `spawnProcess(["open"/"xdg-open",url])` for `markdown-follow-link` | **(c)** — opening a URL belongs on the laptop (S), not A. Unchanged. (Only caveat: if invoked *on A* it would try to open a browser server-side — harmless no-op.) |
| **dogfood** | `dogfood/index.ts:27,44,61` | append/read/write `~/.jemacs/cmdlog.tsv` (command telemetry) | **(c)** — S-side telemetry of the laptop editor; no `buffer.path` involved. Unchanged. |

## Secondary (reads `editor.lsp` state, no spawn/FS)

These work **unchanged once the S-side `editor.lsp` stub is populated** from
`{kind:"lsp"}` ops — listed so the stub's surface is known:

| Plugin | File:Line | Reads | Note |
|---|---|---|---|
| flymake-nav | `flymake-nav/index.ts:38-42,85-89` | `editor.lsp.bufferWorkspaces(b)` → `diagnosticsByPath` | (c) if stub exposes diagnostics; `:149` `process.cwd()` fallback is wrong for remote |
| completion-preview | `completion-preview/index.ts:44` | mode `completeAtPoint` (in-buffer symbol scan) | (c) — no LSP, no FS |

## Already fine (only `buffer.text` / `point` / `locals` / layout)

`save-hooks`¹, `avy`, `comment-dwim`, `electric-pair`, `fido`, `isearch-regexp`,
`mark-ring`, `motion`, `org`², `osc52`³, `register-text`, `sexp`, `show-paren`,
`smerge`, `subword`, `tiling`, `which-key`, `window`, `windmove`,
`gruvbox-dark-hard`, `demo-plugin`.

¹ `save-hooks` advices `save-buffer` to run `delete-trailing-whitespace`
  (text-only). The actual save routes via `{command}` per DESIGN; the
  before-hook's text mutation flows as a splice first. No change needed.
² `org` reads `buffer.path` only for extension sniffing (mode dispatch).
³ `osc52` writes to the *S-side* terminal's clipboard via escape sequence —
  correct for the shadow.
