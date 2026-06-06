export const meta = {
  name: 'jemacs-engineers',
  description: 'Drain p0/p1 tasks with owns assigned; file-partitioned parallel; append done/notes to queue',
  phases: [{ title: 'Load' }, { title: 'Drain' }],
}
const REPO = '/root/src/jemacs'
const QUEUE = REPO + '/do_not_commit/team/tasks.jsonl'
const RESULT = { type:'object', properties:{ id:{type:'string'}, ok:{type:'boolean'}, files:{type:'array',items:{type:'string'}}, notes:{type:'string'} }, required:['id','ok','files','notes'] }

phase('Load')
const ready = await agent(
  'Read ' + QUEUE + ' (last-write-wins by id). Return tasks where status=open AND priority∈{p0,p1,p2} AND owns is set and ≠ "-". ' +
  'Dedupe by owns (if two tasks share owns, keep higher priority then earlier ts; merge the other into its detail). Cap at 12.',
  { label: 'load-ready', phase: 'Load', schema: { type:'object', properties:{ tasks:{ type:'array', items:{ type:'object' } } }, required:['tasks'] } })

if (!ready.tasks.length) { log('no ready tasks'); return { drained: 0 } }
log('draining ' + ready.tasks.length + ' tasks')

phase('Drain')
const out = await parallel(ready.tasks.map(t => () =>
  agent(
    'Engineer task in ' + REPO + '. id=' + t.id + ' [' + t.kind + '] ' + t.title + '\n' + t.detail + '\n' +
    'OWNS (edit ONLY): ' + t.owns + '\n' +
    'If bug: test/bugs/loop-' + t.id + '.test.ts as test.failing → fix → flip. If feature: plugins/ + test. If refactor: minimal diff. ' +
    'DO NOT commit. DO NOT git stash (shared worktree — other agents are editing). Verify: JEMACS_SKIP_TUI=1 bun test <your test files only> — NOT the full suite (leaks tui processes). Append nothing to the queue — return result.',
    { label: 'eng:' + (t.id || t.title.slice(0,20)).replace(/\W+/g,'-'), phase: 'Drain', schema: RESULT })
))

// Coordinator (caller) appends status=done lines after verifying suite.
return { drained: out.filter(Boolean).length, results: out.filter(Boolean) }
