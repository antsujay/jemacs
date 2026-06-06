# Shadow — remote editing with local-feeling latency

Two `Editor` instances: **A** (authority, server) and **S** (shadow, your laptop). S applies edits optimistically and renders immediately; A is the truth. Ops, not snapshots, go over the wire. When A's truth diverges from S's prediction, S rebases.

## Ops

```ts
type Seq = number  // monotone per (peerId)
type Splice = { kind: "splice"; bufferId: string; from: number; to: number; text: string; seq: Seq }
type Point  = { kind: "point";  bufferId: string; point: number; seq: Seq }
type Buffer = { kind: "buffer"; id: string; path?: string; text: string; mode: string }
type Layout = { kind: "layout"; tree: WindowNode }
type Cmd    = { kind: "command"; name: string; args: unknown[]; seq: Seq }   // S→A only, trust:"full" only
type Ack    = { kind: "ack"; upTo: Seq }
type Rebase = { kind: "rebase"; bufferId: string; baseSeq: Seq; ops: Splice[] }
type Lsp    = { kind: "lsp"; bufferId: string; diagnostics?: Diagnostic[]; hover?: string; completion?: Candidate[] }
type ShadowOp = Splice | Point | Buffer | Layout | Cmd | Ack | Rebase | Lsp
```

`Cmd` flows S→A only. A only ever sends `splice`/`point`/`buffer`/`layout`/`ack`/`rebase`/`lsp`. Enforced at `applyRemoteOp(link, op)` chokepoint.

## Link

```ts
interface ShadowLink {
  readonly peerId: string
  readonly trust: "full" | "propose"      // server-side per auth, never read from wire
  send(op: ShadowOp): void
  on(handler: (op: ShadowOp) => void): void
  close(): void
}
```

`BufferModel` gains `link?: ShadowLink`. A buffer with `link` set is remote — `save()` etc. route via `{command:...}` instead of local FS.

## Reconciliation

S keeps `pending: Splice[]` per buffer (ops sent, not yet ack'd). On `ack{upTo}`: drop pending with `seq ≤ upTo`. On `rebase{baseSeq, ops}`:

1. Rewind buffer to `baseSeq` via op-log undo (walk parent pointers).
2. Apply A's `ops`.
3. Transform each pending op with `seq > baseSeq` by A's ops (offset shift — same as `_splice`'s mark-adjust), re-apply.
4. `pending` is now relative to A's new tip.

The transform: for pending op at `[from,to)` and A's op `[aFrom,aTo)→aText`: if `to ≤ aFrom`, no change. If `from ≥ aTo`, shift by `aText.length - (aTo - aFrom)`. If they overlap, the pending op is *invalidated* (its target text changed) — drop it and re-render so the user sees their edit didn't survive.

## Speculative rendering

`buffer.locals["shadow-pending"]: Splice[]`. The display layer renders the *applied* text (S already has it), but maps pending ranges to `face: "shadow-pending"` (dim). Modeline: `[⇅ 3]` when `pending.length > 0`, `[✓]` when 0, `[⊘ partition]` when `link.partitioned`.

## Determinism (for DST)

`_splice` is already deterministic. Leaks to plug: `crypto.randomUUID()` in `BufferModel` constructor (sim passes explicit ids); `Date.now()` in any op path (none currently).

## DST simulator

`FakeLink implements ShadowLink` with `inflight: ShadowOp[]`, `partitioned: boolean`, `tick(n)` delivers up to n ops subject to `reorder`/`drop`/`dup`/`delay` adversary. `Simulator(seed)` owns A, S, baseline (single-proc oracle), FakeLink, seeded PRNG. Property after `link.drain()`: `A.buffers ≡ S.buffers ≡ baseline.buffers`.

## Content-addressed buffer sync

Opening a file shouldn't ship the whole text if S already has it.

```ts
type BufferRef = { kind: "buffer"; id: string; path?: string; sha: string; mode: string }   // no text
type Have      = { kind: "have"; id: string; sha: string }   // S→A: I have this content
type Want      = { kind: "want"; id: string }                // S→A: send me the text
type Chunk     = { kind: "chunk"; id: string; offset: number; data: string; eof?: true }
```

A sends `BufferRef` first. S checks `~/.jemacs/cas/<sha>` and its local `path`:
- **Hit** → render instantly from cache, send `Have{sha}`. Zero text bytes.
- **Stale** (have *a* version, wrong sha) → render the stale version immediately with `[⊘ syncing]`, send `Have{cachedSha}`. A diffs `cachedSha`→`sha` (via git or its own CAS) and sends as `rebase{ops}`. First paint instant; correction is a small diff.
- **Miss** → send `Want`, A streams `Chunk`s.

CAS is `~/.jemacs/cas/<sha256(text)>`, populated on every received `Chunk` set and every local save. Prune by atime.

The stale case is the same rebase machinery — S's "prediction" is its cached text, A's "truth" is current, reconcile as usual. No new convergence logic.

Deferred: rsync-style block delta for the "neither side has the other's exact content" case. Cache-hit covers reconnect + same-checkout-locally, which is most of the value.

## Transport (generic)

`ShadowLink` is the interface; transports are implementations:

| transport | impl | use |
|---|---|---|
| `StdioLink` | subprocess stdin/stdout, length-prefixed JSON | **primary remote** — `ssh host jemacs --serve-stdio` |
| `WsLink` | `ws://127.0.0.1:port` + token | attach a second S to an already-running A |
| `FakeLink` | in-process queue | DST |

`shadow-connect` takes a URI: `ssh://user@host[/path]`, `ws://host:port`, `stdio:CMD`. It picks the transport, establishes the link, calls `attachShadow`.

## Self-install (VSCode Remote-style)

`shadow-connect ssh://host` does, in order:

1. `ssh host 'test -x ~/.jemacs/bin/jemacs-$VERSION'` — if present, skip to 4.
2. `ssh host 'curl -fsSL https://bun.sh/install | bash'` (if `bun` missing).
3. `scp` (or `ssh cat | tar x`) the local jemacs bundle to `~/.jemacs/bin/jemacs-$VERSION/`. Version-pinned so client/server protocol always matches.
4. `ssh host '~/.jemacs/bin/jemacs-$VERSION/jemacs --serve-stdio'` → `StdioLink` over the ssh process.

The bundle is `bun build --compile` output (single binary) or a tarball of `src/`+`lisp/`+`plugins/`+`node_modules` if compile isn't ready. `$VERSION` = `git rev-parse --short HEAD` so a mismatch is impossible.

## LSP bootstrap on A

A's `lsp/clients/*.ts` already gate on `which <server>`. On miss, instead of silently disabling: `editor.message("<server> not on remote — M-x lsp-install-server")`. `lsp-install-server` (per-client) runs the idiomatic installer on A: `rustup component add rust-analyzer`, `go install golang.org/x/tools/gopls@latest`, `bun add -g typescript-language-server`. The command runs on A (it's a normal `{command:...}` from S); output streams back into `*lsp-install*`.

## Local play + integration (after DST is green)

`WsLink implements ShadowLink` over a `ws://127.0.0.1:port` socket. `M-x shadow-serve` (A) prints a one-time token + port; `M-x shadow-connect HOST:PORT TOKEN` (S) handshakes and attaches.

Local play: two jemacs in side-by-side tmux panes, `shadow-serve` left, `shadow-connect` right, type in right and watch left converge. `scripts/shadow-pair.sh` spawns both.

Integration test (`test/shadow/integration.test.ts`, `JEMACS_SKIP_TUI`-gated): spawn two real `bun run src/main.ts` processes via tmux, drive S with `tui-drive.sh keys`, assert A's buffer text matches via a `--dump-buffer` CLI flag. This is the layer-3 proof — real socket, real processes, real keystrokes.

## Plugin remote-awareness

Plugins that spawn subprocesses or touch FS check `buffer.link`:
- `compile`/`magit`/`project`: send `{command: name, args}` to A; output streams back as splice on `*compilation*`/`*magit*` (which A creates and `{kind:"buffer"}`-sends).
- `term`: pty on A; `term-send-raw` → `{command}`; output → splice.
- `lsp-*`: `editor.lsp` for remote buffers is a stub that sends `{command:"lsp-*"}` and resolves on `{kind:"lsp"}`.
- `auto-save`/`persist`: skip remote buffers (A owns persistence).
