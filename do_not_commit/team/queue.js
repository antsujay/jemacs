// Shared queue helpers — imported by each role script.
// (Workflow scripts can't import, so each role inlines a copy of read/append.)

export const QUEUE = '/root/src/jemacs/do_not_commit/team/tasks.jsonl'

export function readQueue(text) {
  const lines = text.trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  // last-write-wins by id
  const byId = new Map()
  for (const t of lines) byId.set(t.id, { ...byId.get(t.id), ...t })
  return [...byId.values()]
}

export function stats(tasks) {
  const open = tasks.filter(t => t.status !== 'done')
  return {
    total: tasks.length,
    open: open.length,
    unranked: open.filter(t => t.priority === 'unranked').length,
    p0NoOwns: open.filter(t => t.priority === 'p0' && (!t.owns || t.owns === '-')).length,
    p0Ready: open.filter(t => (t.priority === 'p0' || t.priority === 'p1') && t.owns && t.owns !== '-' && t.status === 'open').length,
  }
}
