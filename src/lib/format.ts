// Pure presentation helpers (unit-tested). NOTE: these are display-only —
// authoritative locking/scoring live in Postgres, never here (spec §10).

/** Whether a match's pick window has closed, given its kickoff. Display hint
 *  only; the server is the source of truth and re-checks on every write. */
export function isLocked(kickoffIso: string, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(kickoffIso).getTime()
}

/** Human countdown to lock, e.g. "2d 4h", "3h 12m", "8m", or "Locked". */
export function countdownToLock(kickoffIso: string, now: Date = new Date()): string {
  const ms = new Date(kickoffIso).getTime() - now.getTime()
  if (ms <= 0) return 'Locked'
  const mins = Math.floor(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/** Local kickoff time label, e.g. "Thu 16:00". */
export function kickoffLabel(kickoffIso: string): string {
  const d = new Date(kickoffIso)
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
