# Team — loosely-coupled roles around a shared queue

Each role is a standalone workflow script. They communicate only through
`tasks.jsonl` (one task per line) and `git log`. No role waits on another.

## The queue

`do_not_commit/team/tasks.jsonl` — append-only. Each line:
```json
{"id":"t-<short>","ts":<ms>,"kind":"bug|feature|refactor|test","priority":"p0|p1|p2|unranked","owns":"<file or '-'>","status":"open|claimed|done","title":"...","detail":"...","by":"qa|study|pm|tl|user"}
```
Roles read the whole file, filter, and append new lines (status changes are
new lines with the same id — last-write-wins on read).

## Roles (each is `Workflow({scriptPath: "do_not_commit/team/<role>.js"})`)

| role | trigger | reads | writes |
|---|---|---|---|
| `qa.js` | after commits land (check `git log -5`) | recent commits | tasks (kind=bug) |
| `study.js` | low queue depth or new plugin | examples/, compare-*.md | tasks (bug/feature) |
| `pm.js` | unranked tasks > N, or time-based | queue, PRODUCT.md, pm-research | re-priority lines |
| `techlead.js` | open p0/p1 without `owns`, or time-based | queue, deep-review, ARCHITECTURE | owns + refactor tasks |
| `engineers.js` | open p0/p1 with `owns` > 0 | queue (filter status=open, owns≠'-') | code + status=done lines |

## Coordinator

`coordinator.js` reads queue stats + `git log --since` and decides which roles
to spawn this tick:
```
unranked > 5        → pm
open p0 owns='-'    → techlead
open p0 owns≠'-'    → engineers
new commits since   → qa
queue depth < 3     → study
```
Then `parallel()` over the chosen subset. Re-invoke on a loop or after each
engineer batch.
