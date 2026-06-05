# src/lsp/

Eglot-style thin client — protocol I/O + apply edits; UI lives in plugins (flymake-nav, lsp-extras, eldoc).

| file | what |
|---|---|
| `client.ts` | `LspClient` registry, `LspConnection` interface |
| `transport.ts` | `LspMessageParser` (Content-Length framing), `serializeMessage` |
| `stdio.ts` | `stdioConnection(cmd)` — spawn + stream |
| `rpc.ts` | request/response correlation, notification dispatch |
| `manager.ts` | per-editor `LspManager`; `attachBuffer`/`startWorkspace` |
| `sync.ts` | `didOpen`/`didChange` plumbing |
| `clients/` | per-server config (rust-analyzer, ts-ls, pylsp, gopls, yaml) |

Test with `test/harness/fake-lsp.ts` — `fakeLspServer()` is an in-memory `LspConnection` that captures sent JSON and lets you inject responses.
