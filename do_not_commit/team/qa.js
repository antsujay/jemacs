export const meta = {
  name: 'jemacs-qa',
  description: 'QA recent commits in a worktree via tui-drive; append bug tasks to queue',
  phases: [{ title: 'QA' }],
}
const REPO = '/root/src/jemacs'
const QUEUE = REPO + '/do_not_commit/team/tasks.jsonl'
const TASKS = { type:'object', properties:{ tasks:{ type:'array', items:{ type:'object' } } }, required:['tasks'] }

phase('QA')
const r = await agent(
  'QA jemacs in a worktree (git worktree add -f /tmp/jemacs-qa-$$ ' + REPO + '; symlink node_modules). ' +
  'Read git -C ' + REPO + ' log --oneline -6; for each commit that touches plugins/ or src/, drive the changed feature via JEMACS_TMUX_SESSION=qa-$$ scripts/tui-drive.sh. ' +
  'For each break: append a line to ' + QUEUE + ': {"id":"t-"+<6-hex>, "ts":<now>, "kind":"bug", "priority":"unranked", "owns":"-", "status":"open", "title":..., "detail":..., "by":"qa", "sha":<head>}. ' +
  'Return the tasks you appended. Clean up worktree.',
  { label: 'qa', phase: 'QA', schema: TASKS })
return r
