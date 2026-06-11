// "Match Day" pitch logic (the live stadium dashboard). PURE + unit-tested: how
// pickers split onto the two sides, each team's jersey colour, whether a user has
// finished the round (→ redirect to the pitch), and which side just scored (→ the
// cheer/cry animation). The screen/components consume these; keeping them pure
// makes the behaviour testable without rendering.
import type { MatchRow } from './database.types'

export type Side = 'home' | 'away' | 'draw'

export interface Picker {
  user_id: string
  display_name: string
  avatar_config: Record<string, unknown> | null
}

/** Map an outcome selection to the side of the pitch the picker stands on. */
export function sideForSelection(selection: string): Side {
  return selection === 'home' ? 'home' : selection === 'away' ? 'away' : 'draw'
}

/** Group pickers (outcome market) by the side they backed. */
export function assignSides(
  picks: { user_id: string; selection: string }[],
  pickers: Map<string, Picker>,
): Record<Side, Picker[]> {
  const out: Record<Side, Picker[]> = { home: [], away: [], draw: [] }
  for (const p of picks) {
    const who = pickers.get(p.user_id)
    if (who) out[sideForSelection(p.selection)].push(who)
  }
  return out
}

/** Deterministic, distinct jersey colour for a team code (stable HSL). */
export function jerseyColor(code: string | null | undefined): string {
  const c = code ?? '???'
  let h = 0
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360
  return `hsl(${h}, 68%, 45%)`
}

/** Readable text colour (black/white) for a given jersey hue. */
export function jerseyText(code: string | null | undefined): string {
  const c = code ?? '???'
  let h = 0
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360
  // greens/yellows (60–190) read better with dark text; others with white.
  return h >= 50 && h <= 195 ? '#0A2540' : '#FFF4DC'
}

/** Has the user made an OUTCOME pick on every match in the round? */
export function roundComplete(
  outcomePickedMatchIds: Iterable<number>,
  roundMatchIds: number[],
): boolean {
  if (roundMatchIds.length === 0) return false
  const picked = new Set(outcomePickedMatchIds)
  return roundMatchIds.every((id) => picked.has(id))
}

/** Which side just scored, comparing a previous snapshot to the next. null = no new goal. */
export function scoredSide(
  prev: Pick<MatchRow, 'home_score' | 'away_score'> | undefined | null,
  next: Pick<MatchRow, 'home_score' | 'away_score'>,
): Side | null {
  if (!prev) return null
  const ph = prev.home_score ?? 0
  const pa = prev.away_score ?? 0
  const nh = next.home_score ?? 0
  const na = next.away_score ?? 0
  if (nh > ph) return 'home'
  if (na > pa) return 'away'
  return null
}

/** Pick the matches to show as tabs on Match Day, and the default selection:
 *  live matches first (most relevant); else the most recently kicked-off; else
 *  the next upcoming one. Picks are only cross-visible after kickoff, so a
 *  not-yet-started match only ever shows the viewer's own spot. */
export function matchDayTabs(
  matches: MatchRow[],
  now: Date = new Date(),
): { tabs: MatchRow[]; defaultId: number | null } {
  const t = now.getTime()
  const started = matches.filter((m) => new Date(m.kickoff).getTime() <= t)
  const live = started.filter((m) => m.status === 'live')
  if (live.length) return { tabs: live, defaultId: live[0]!.id }
  if (started.length) {
    const recent = [...started].sort((a, b) => new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime())
    return { tabs: recent.slice(0, 6), defaultId: recent[0]!.id }
  }
  const upcoming = [...matches].sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime())
  return { tabs: upcoming.slice(0, 1), defaultId: upcoming[0]?.id ?? null }
}
