# lsp-mode port (Jemacs)

Upstream: [emacs-lsp/lsp-mode](https://github.com/emacs-lsp/lsp-mode)  
Local ELPA snapshot: `lsp-mode-20240529.2057` (version 9.0.1)

## What was ported

| Emacs (Elisp) | Jemacs (TypeScript) |
| --- | --- |
| `lsp-mode.el` — JSON-RPC framing, parser filter, request/response routing | `protocol.ts`, `rpc.ts` |
| `lsp--client`, `lsp--workspace`, `lsp-session` structs | `client.ts`, `workspace.ts`, `session.ts` |
| `lsp-register-client`, `lsp-stdio-connection`, `lsp` entry | `client.ts`, `stdio.ts`, `manager.ts` |
| `lsp--start-workspace` / `initialize` / `initialized` | `workspace.ts` |
| `textDocument/didOpen`, `didChange`, `didClose` | `sync.ts` |
| `textDocument/publishDiagnostics` | `diagnostics.ts` |
| `textDocument/completion` (from `lsp-completion.el`) | `completion.ts` |
| `lsp-pylsp.el` client definition | `clients/pylsp.ts` |

## Not ported (yet)

- Full `lsp-protocol.el` generated types (use loose JSON records)
- TRAMP, multi-root folder UI, file watchers, semantic tokens, lenses, DAP
- Per-language `lsp-*.el` clients beyond pylsp
- Company-mode / capf integration (Jemacs uses `completeAtPoint` instead)

## Emacs command names preserved

`lsp`, `lsp-mode`, `lsp-shutdown-workspace`, `lsp-workspace-restart`, `lsp-describe-session`, `lsp-toggle-trace-io`
