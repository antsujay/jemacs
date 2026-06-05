export const meta = {
  name: 'jemacs-team-coordinator',
  description: 'Read queue + git state, decide which roles to spin up this tick, run them in parallel',
  phases: [{ title: 'Decide' }, { title: 'Run' }],
}

const REPO = '/root/src/jemacs'
const QUEUE = REPO + '/do_not_commit/team/tasks.jsonl'

phase('Decide')
const probe = await agent(
  'Read ' + QUEUE + ' (may not exist — treat as empty). Parse last-write-wins by id. ' +
  'Also run: git -C ' + REPO + ' log --oneline -8. ' +
  'Return: {open, unranked, p0NoOwns, p0Ready, recentCommits: [<sha title>...], lastQaSha: <sha of newest task with by=qa or null>}.',
  { label: 'probe', phase: 'Decide', schema: {
    type: 'object',
    properties: {
      open: { type: 'integer' }, unranked: { type: 'integer' },
      p0NoOwns: { type: 'integer' }, p0Ready: { type: 'integer' },
      recentCommits: { type: 'array', items: { type: 'string' } },
      lastQaSha: { type: ['string','null'] },
    },
    required: ['open','unranked','p0NoOwns','p0Ready','recentCommits'],
  }})

const roles = []
if (probe.recentCommits.length && probe.recentCommits[0].split(' ')[0] !== probe.lastQaSha) roles.push('qa')
if (probe.open < 4) roles.push('study')
if (probe.unranked > 3) roles.push('pm')
if (probe.p0NoOwns > 0) roles.push('techlead')
if (probe.p0Ready > 0) roles.push('engineers')
if (!roles.length) roles.push('study')  // never idle
log('spinning up: ' + roles.join(', ') + '  (open=' + probe.open + ' unranked=' + probe.unranked + ' p0Ready=' + probe.p0Ready + ')')

phase('Run')
const results = await parallel(roles.map(r => () => workflow({ scriptPath: REPO + '/do_not_commit/team/' + r + '.js' })))
return { ran: roles, probe, results }
