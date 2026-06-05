# Product: feature priority

What to port next, ranked by (daily-use frequency × leverage) ÷ surface area.

**Shipped** (28 builtin plugins): motion · mark-ring · save-hooks · comment-dwim · subword · electric-pair · show-paren · isearch-regexp · windmove · next-error · flymake-nav · fido · persist · auto-revert · auto-save · lsp-extras/-monorepo/-watchman · which-key · eldoc · project · compile · completion-preview · magit-status · dogfood · term/term-v2 · wdired · smerge · osc52.

## The wedge

Per a survey of public Emacs discussion: the dominant 2025-26 conversation isn't packages, it's **supply-chain**. "Audited TypeScript on npm-with-approval, no MELPA `eval`-on-install" is the one-line answer to "why not just use Emacs". Lead with that.

## Ship next

| feature | why | size | notes |
|---|---|---|---|
| **PluginContext (hot reload)** | DESIGN.md step 1; 3 `test.failing` repros exist; unblocks live plugin dev | M | `install(editor, ctx)` where `ctx.command/key/hook/advice` record + `dispose()` on reload |
| **magit hunk-level** | v1 stages whole files; hunk stage/unstage is the actual workflow | M | parse `git diff` hunk headers, `s`/`u` on hunk → `git apply --cached` with the hunk |
| **undo-tree** | still full-buffer snapshots O(n); 207 logged uses | M | op-log + tree; visualizer can wait |
| **flymake-show-buffer-diagnostics** | can't see all errors at once (in p2 queue) | XS | location-list view of `diagnostics.ts` spans |
| **avy/ace-jump** | stubs exist; fast char-addressed jump | S | overlay candidate chars, read one key |

## High value, real investment

| feature | why | size | 80/20 cut |
|---|---|---|---|
| **org-mode** | notes/TODO/agenda | L | headline folding (TAB) + `TODO`/`DONE` cycling (`C-c C-t`) only. tree-sitter-org for structure. Skip tables/babel/export |
| **tramp** | edit remote files over ssh | M | `/ssh:host:/path` in find-file → `RemoteFS` shells `ssh host cat`/`tee`. SaveContext already abstracts I/O |
| **lean4-mode** | 1167 logged commands; only language gap | L | InfoView LSP extensions are bespoke |
| **lisp/ carve-out** | DESIGN.md core/lisp split; deep-review found 18 1:1-wrapped Editor methods | M | move command bodies out of `editor.ts`, leave kernel as state+dispatch |
| **i3 windows** | nostalgia keymap exists; tabbed/stacked containers | M | `WindowNode.layout` field + numbered workspaces |

## Architecture (from DESIGN.md / deep-review)

| item | closes | size |
|---|---|---|
| `post-command-hook` from `editor.run()` | 4 plugins string-match `changed.reason` as fake hook | S |
| `Editor.setPointInSelectedWindow()` | 4 callsites reach into private `windowLayout` | XS |
| Delete dead `Keymap.pending`/`feed` | latent confusion (keyboard-quit no-op) | XS |
| `defgeneric`/`defmethod` for per-mode dispatch | open `forward-sexp`/`indent-line` to plugins | S |

## Defer

ediff (smerge covers it) · flycheck (flymake-nav + LSP) · company/corfu (fido + completion-preview) · yasnippet (LSP snippets first) · helm/ivy (fido is the bet) · remote shadow-kernel (ROADMAP long-term).

## Decision principle

Port the *interface*, not the implementation. magit's value is the keymap + status-buffer layout — `git` subprocess does the plumbing. org-mode's value is `TAB` folding + `C-c C-t`, not the exporter. Every port is the smallest thing that makes the muscle memory work.
