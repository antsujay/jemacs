#!/usr/bin/env python3
"""Append audit2 collapse-test survivors + structural task to tasks.jsonl."""
import hashlib, json, time, os

OUT = "/root/src/jemacs/do_not_commit/team/tasks.jsonl"
ts = int(time.time() * 1000)

def tid(title: str) -> str:
    return "t-audit2-" + hashlib.sha1(title.encode()).hexdigest()[:8]

# (orig_idx, priority, kind, owns, title, detail)
# Dropped as DUPES: 27 (→26), 72 (→38), 75 (→47)
# Dropped as CLOSED-BY-STRUCTURAL: 21, 60, 61, 62, 65, 68
TASKS = [
  (0,  "p0","bug","src/shadow/cas.ts","FileCas.write is non-atomic — crash mid-write leaves truncated cas/<sha>","Write to tmp + rename(2) so a crash leaves either old or new, never a truncated blob keyed by content hash."),
  (1,  "p0","bug","src/shadow/remote-runtime.ts","writeFileText optimistic manifest patch is never rolled back when A rejects the write","Shadow applies the manifest delta before A acks; on reject the local manifest diverges. Roll back or hold until ack."),
  (2,  "p0","bug","src/shadow/link.ts","Coalesced waiters hang forever on link close — readFileText/stat/readdir never resolve","On link.close(), reject all pending coalesced promises with LinkClosed so callers can surface an error instead of hanging."),
  (3,  "p1","bug","src/shadow/shadow.ts","AuthorityFs.watch drops events that arrive during a rebuild","Events firing while the tree rebuild is in flight are lost. Queue events received during rebuild and replay after."),
  (4,  "p1","bug","src/shadow/shadow.ts","AuthorityFs.watch rebuilds + hashes the entire tree on every watcher event","O(tree) per fs event. Incrementally rehash only the affected path's ancestors."),
  (5,  "p1","bug","src/shadow/shadow.ts","ShadowState.sent grows unbounded — pruned only on rebase, never on ack","Ack should prune sent[seq]; today only rebase clears it, so memory grows for the life of the link."),
  (6,  "p1","bug","src/shadow/manifest.ts","ManifestCache grows unbounded; applyDelta leaks grandchild dir listings on subtree delete","Deleting a dir removes its own entry but not cached listings of its descendants. Walk and evict subtree on delete; add a cap."),
  (7,  "p1","bug","src/shadow/link.ts","A→S Chunks have no reliability layer — one dropped chunk wedges the buffer in [⊘ syncing]","No seq/ack/retransmit on the chunk stream. A single drop leaves the receiver waiting forever."),
  (8,  "p1","bug","src/shadow/ops.ts","bindSeq lifecycle: runtime Cmds before attachShadow collide with state.nextSeq → silently deduped by A","Cmds issued before attachShadow get seq numbers from the same counter A later restarts at; A treats them as dupes and drops them."),
  (9,  "p1","bug","src/shadow/remote-runtime.ts","RemoteRuntime.readdir is O(total cached entries), not O(dir children)","Iterates the whole manifest map per readdir. Index children by parent."),
  (10, "p1","bug","src/shadow/ops.ts","chunkText splits at fixed UTF-16 offsets — surrogate pairs torn across chunks corrupt over UTF-8 links","Slice on code-point boundaries (or byte-slice the UTF-8 encoding) so a surrogate pair is never split."),
  (11, "p2","bug","src/shadow/manifest.ts","dirHash sort comparator never returns 0; mtime/size excluded → dired shows stale timestamps","Comparator returns ±1 only (unstable sort); hash ignores mtime/size so timestamp changes don't invalidate."),
  (12, "p0","bug","src/web/shadow-entry.ts","No WS reconnect in shadow mode; save-buffer silently no-ops after disconnect","Add reconnect-with-backoff and surface link state in the modeline; until reconnected, save-buffer must error not no-op."),
  (13, "p1","bug","src/web/client-bridge.ts","Thin client: no reconnect; optimistic caret moves while input is dropped","Same reconnect gap as shadow-entry; additionally, prediction keeps moving the caret after the socket is dead."),
  (14, "p1","bug","src/web/web-layout.ts","webLayout ships the entire buffer twice per frame — O(file size) per keystroke","DisplayModel carries full buffer text on every render. Ship only the visible viewport (or diffs)."),
  (15, "p1","bug","src/web/shadow-entry.ts","render() fires on every 'changed' with no batching","Coalesce into rAF / microtask so a burst of changes renders once."),
  (16, "p1","bug","src/web/idb-cas.ts","open() caches a rejected promise forever; lookupAsync throws while write swallows","First open() failure is memoized so all later calls fail; write() catches and discards errors so corruption is silent."),
  (17, "p1","bug","src/web/idb-cas.ts","IdbCas has no eviction path → unbounded IndexedDB growth","Add LRU/size cap and a sweep; CAS blobs accumulate forever today."),
  (18, "p1","bug","src/web/idb-cas.ts","Multi-tab: no onblocked / onversionchange — schema bump deadlocks open() forever","Register onversionchange to close the connection and onblocked to surface an error."),
  (19, "p1","bug","src/web/client-bridge.ts","predict() assumes one .body-row == one visual line; wrong on wrapped lines and surrogate pairs","Prediction maps DOM row index to buffer line 1:1; soft-wrap and astral chars break the mapping."),
  (20, "p2","bug","src/web/idb-cas.ts","lookupAsync atime-touch re-puts the full blob; races with delete; size miscounted","Touching atime rewrites the entire value; concurrent delete can resurrect it; size accounting double-counts."),
  (22, "p2","bug","src/web/host.ts","hostAllowed: no Origin check on /ws; case-sensitive Host compare","CSWSH: any page can open the WS. Check Origin; lowercase Host before compare."),
  (23, "p2","bug","src/web/host.ts","present() discards the incoming DisplayModel and rebuilds from scratch","Host ignores the model it's handed and recomputes — wasted work and a divergence risk."),
  (24, "p0","bug","src/display/logical.ts","displayFilter / mode-line-misc-info throw → whole render crashes","Wrap user-supplied display callbacks in try/catch; render an error chunk instead of taking down the frame."),
  (25, "p0","bug","src/display/logical.ts","LogicalPane.buffer / .locals are live refs — not a snapshot, defeats serialization","DisplayModel holds references to mutable kernel objects. Snapshot the fields the renderer actually needs."),
  (26, "p1","bug","src/display/char-grid-layout.ts","startLine raw-line-indexed but used to slice displayText; computeLineVisualRows fed displayText lines indexed by raw line number","Two symptoms of one index-space confusion: window.startLine is a raw-text line index but is used against the post-displayFilter text. Normalize to one index space at the top of layout. (Subsumes audit item 27.)"),
  (28, "p1","bug","src/display/build-display-model.ts","syncWindowBodyGeometry is per-buffer, but walked per-window — last split wins","Geometry is stored on the buffer, so two windows on the same buffer overwrite each other; last-visited split's geometry wins."),
  (29, "p1","bug","src/display/build-display-model.ts","syncWindowBodyGeometry runs before buildLogicalModel but locals is aliased — ordering is fragile","Only works because locals is the same object reference. Make the data dependency explicit."),
  (30, "p1","bug","src/display/dom-frame.ts","click-to-point uses fixed rowPx/colPx — wrong for variable-pitch faces","Hit-testing assumes a monospace grid. Use measured glyph rects for variable-pitch."),
  (31, "p1","bug","src/display/dom-frame.ts","Full DOM rebuild every present() — perf cliff, esp. terminal surfaces","Diff against the previous frame and patch; full rebuild is the current behavior."),
  (32, "p1","bug","src/display/logical.ts","displayMap is a function on a data type — silently dropped by JSON, retains large closures","DisplayModel must be plain data. Replace displayMap with a serializable descriptor or move the closure to the host side."),
  (33, "p2","bug","src/display/char-grid-layout.ts","padBodyLines pushes the same pad chunk object N+1 times","Aliased chunk objects: mutating one mutates all; also off-by-one (N+1 pads)."),
  (34, "p2","bug","src/display/build-display-model.ts","selectedVisualRows re-runs displayFilter twice more per frame","displayFilter already ran in buildLogicalModel; cache its output and reuse."),
  (35, "p2","bug","src/display/dom-frame.ts","renderCaret rAF callback never cancelled — runs against detached nodes","Cancel the pending rAF on teardown / re-render."),
  (36, "p0","bug","src/modes/diff.ts","Path traversal: diff-supplied `..` paths escape default-directory and get written to","diff-apply / goto-source resolve hunk file paths without normalizing — a malicious patch with ../ writes outside the project."),
  (37, "p0","bug","plugins/magit/magit.ts","magit-patch-save silently clobbers existing files","Use exclusive-create or prompt before overwrite."),
  (38, "p1","bug","src/modes/diff.ts","patchForHunk leaks earlier hunks' body lines into the header for hunk #2+","Slicing logic accumulates: hunk N's extracted patch includes body lines from hunks 1..N-1. Breaks C-c C-a / C-c C-t / diff-kill-applied on any hunk after the first. (Subsumes audit item 72.)"),
  (39, "p1","bug","src/modes/diff.ts","diff-reverse-direction corrupts context and normal diffs","Only handles unified format; context (***) and normal diffs come out mangled."),
  (40, "p1","bug","src/modes/diff.ts","diff-goto-source off-by-one when hunk contains `\\ No newline at end of file`","The marker line is counted as a body line, shifting the target by one."),
  (41, "p1","bug","plugins/magit/magit.ts","magit-section-toggle computes point from a default-context build, lands wrong when context≠3","Section offsets baked in for -U3; with a different context the cursor lands inside the wrong section."),
  (42, "p1","bug","plugins/magit/magit.ts","magit-discard on an untracked file errors instead of removing it","Untracked path goes down the 'git checkout' branch which fails; should rm the file."),
  (43, "p1","bug","src/modes/diff.ts","Global save hooks leak across hot-reload: duplicate diffFixupModifs per reload","addHook is additive; each reload of diff.ts registers another copy. Route through PluginContext so dispose() removes the prior registration."),
  (44, "p1","bug","src/modes/diff.ts","after-save delete-empty hook is not gated by isDiffBuffer","Runs on every buffer's after-save. Gate on mode."),
  (45, "p1","bug","src/modes/diff.ts","Perf cliff: every nav keypress re-parses the whole diff and re-slices every line","Parse once per buffer-text revision; cache hunk index keyed on text hash."),
  (46, "p2","bug","src/modes/diff.ts","Hunk-kill leaves orphaned file headers; killAppliedHunks never cleans them","After the last hunk under a --- / +++ header is killed, the header remains."),
  (47, "p2","test","test/modes/diff-mode.test.ts","Add adversarial diff fixtures: 2nd-hunk apply, `..` path headers, `\\ No newline` goto-source, context-diff reverse, multi-hunk patchForHunk","Covers tasks 36/38/39/40 regressions. (Subsumes audit item 75: backfill multi-hunk coverage.)"),
  (48, "p1","bug","lisp/window-cmds.ts","C-M-v clobbered: scroll-other-window unreachable via keyboard","Another binding shadows C-M-v in the global map."),
  (49, "p1","bug","lisp/simple.ts","beginning-of-defun / end-of-defun lost prefixArgument in modeFeature refactor","Count arg no longer threaded through after the refactor."),
  (50, "p1","bug","lisp/simple.ts","home/end bound to buffer boundaries instead of line boundaries","Should be move-beginning-of-line / move-end-of-line, not beginning-of-buffer / end-of-buffer."),
  (51, "p1","bug","lisp/simple.ts","replace-string replaces from buffer start, not from point","Emacs replaces from point forward; current impl rewinds to 0."),
  (52, "p1","bug","lisp/simple.ts","goto-line moves to line 1 when prompt is cancelled","Cancelled minibuffer returns '', parsed as 0/NaN → line 1. Abort should leave point unchanged."),
  (53, "p1","bug","lisp/misc.ts","text-scale-increase / text-scale-decrease silently no-op without prefix arg","Default step should be 1 when no prefix is given."),
  (54, "p1","bug","lisp/simple.ts","newline with prefix arg 0 moves to line start instead of no-op","C-u 0 RET should insert nothing and leave point where it is."),
  (55, "p1","bug","lisp/window-cmds.ts","recenter-top-bottom cycle never resets between command invocations","Cycle index persists across unrelated commands; should reset when last-command ≠ recenter-top-bottom."),
  (56, "p1","bug","lisp/misc.ts","call-last-kbd-macro ignores prefixArgument repeat count","C-u N C-x e should repeat N times."),
  (57, "p2","refactor","lisp/simple.ts","Dead code: repeat() helper has no callers","Delete or wire it up."),
  (58, "p2","bug","lisp/window-cmds.ts","DisplayBufferActionFunction lists 4 actions but displayBuffer() dispatches only 1","Either implement the other three or shrink the type."),
  (59, "p2","bug","lisp/simple.ts","undo / undo-redo ignore prefixArgument; clipboard catch{} swallows all errors","Two issues: count not honored; bare catch hides real clipboard failures."),
  (63, "p1","bug","src/web/host.ts","shadow HTML links no CSS → caret never moves visually (and layout is unstyled)","The served page omits the stylesheet link; caret position is CSS-driven so it appears stuck."),
  (64, "p1","bug","src/shadow/install.ts","Authority's active buffer never displayed on Shadow — modeline shows *scratch*, not guide.md","Initial sync sends the manifest but not the authority's selected window/buffer."),
  (66, "p1","bug","src/web/host.ts","nodeWatcher fs.watch crashes the server on a broken symlink under fsRoot","fs.watch throws ENOENT on dangling symlink during initial walk; wrap and skip."),
  (67, "p1","bug","src/web/host.ts","shadow HTML omits `#jemacs-minibuffer-completions` → fido/vertico candidate list never renders","DOM mount point missing from the served template."),
  (69, "p1","test","test/web/shadow-bundle.test.ts","shadow-bundle.test.ts can't catch browser-only ReferenceErrors — `process` and `createHash` leak from Bun","Run the bundle under jsdom/happy-dom (or a real headless page) with node globals stripped, so Node leaks fail the test."),
  (70, "p2","feature","src/web/cdp-driver.ts","cdp-driver lacks persistent profile + console capture — can't QA IDB persistence or see mount-time errors","Add userDataDir + Runtime.consoleAPICalled subscription."),
  (71, "p2","bug","src/web/host.ts","404 on every shadow page load (favicon.ico) — console noise","Serve a 204 or a tiny icon."),
  (73, "p1","test","test/modes/diff-mode.test.ts","Land diff-mode layer-1 QA suite (temp git repo, script() harness)","Integration harness: init a temp git repo, generate real diffs, drive commands via script()."),
  (74, "p2","bug","src/modes/diff.ts","QA brief vs impl: C-c C-s in diff-mode is diff-split-hunk, not 'save patch'","Either the binding or the QA brief is wrong; align with Emacs (C-c C-s = diff-split-hunk)."),
  (76, "p2","bug","src/web/shadow-entry.ts","web QA: C-h k blocked by Chrome trapping Ctrl+H","Chrome eats Ctrl+H for history. Need preventDefault on keydown or an alternate binding for describe-key in web."),
  (77, "p2","test","test/shadow/soak.ts","Promote fs-sim soak harness alongside test/shadow/soak.ts","Wire the fs-sim soak generator into CI alongside the existing soak test."),
]

STRUCTURAL = {
  "priority": "p0",
  "kind": "refactor",
  "owns": "src/platform/",
  "title": "PlatformRuntime is the sole I/O surface: ban direct node:* imports in kernel/lisp/modes/plugins; shadow mounts RemoteRuntime",
  "detail": (
    "Six audit findings (21, 60, 61, 62, 65, 68) are all the same layering violation: "
    "kernel/lisp/modes reach for Node globals (`process`, `crypto.createHash`, `fs/promises`, `process.cwd()`) "
    "directly instead of going through the injected PlatformRuntime, so the shadow bundle throws at module-eval, "
    "BufferRef hashing crashes in-browser, find-file/dired bypass RemoteRuntime, and node-stubs.ts exists only to "
    "paper over the leak. Fix once: (1) PlatformRuntime grows hash(), cwd(), env(), watch(); "
    "(2) Editor is constructed with a PlatformRuntime — NodeRuntime on authority/tty, RemoteRuntime on shadow; "
    "(3) lisp/files.ts save-buffer/find-file call editor.runtime.*, never fs/promises; "
    "(4) eslint no-restricted-imports bans `node:*`, `fs`, `crypto`, `process` outside src/platform/ and src/web/host.ts; "
    "(5) delete node-stubs.ts. "
    "Mirrors the display-seam discipline in ARCHITECTURE.md ('a new host implements UiHost') for the I/O seam. "
    "Closes audit2 items 21/60/61/62/65/68."
  ),
}

rows = []
for (_, prio, kind, owns, title, detail) in TASKS:
    rows.append({
        "id": tid(title), "ts": ts, "kind": kind, "priority": prio,
        "owns": owns, "status": "open", "title": title, "detail": detail, "by": "audit2",
    })
rows.append({
    "id": tid(STRUCTURAL["title"]), "ts": ts, "kind": STRUCTURAL["kind"],
    "priority": STRUCTURAL["priority"], "owns": STRUCTURAL["owns"], "status": "open",
    "title": STRUCTURAL["title"], "detail": STRUCTURAL["detail"], "by": "audit2",
})

# guard against double-append
existing = set()
if os.path.exists(OUT):
    with open(OUT) as f:
        for line in f:
            try:
                existing.add(json.loads(line)["id"])
            except Exception:
                pass

appended = 0
with open(OUT, "a") as f:
    for r in rows:
        if r["id"] in existing:
            continue
        f.write(json.dumps(r, ensure_ascii=False) + "\n")
        appended += 1

print(f"appended={appended} survivors={len(TASKS)} structural=1 total_rows={len(rows)}")
print(f"structural_id={tid(STRUCTURAL['title'])}")
