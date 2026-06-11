// Result-moment queue (spec §7.5). PURE logic: given the user's picks, the
// matches, and the set of matches whose moment they've already seen, produce the
// ordered list of overlays to play — one per newly-finished match the user
// picked. The overlay component + queue manager consume this; keeping it pure
// makes the "a batch of N results plays N sequential overlays" behaviour unit-
// testable (the M4 acceptance, spec §9) without rendering anything.
import type { MatchPick, MatchRow } from './database.types'

export type MomentKind = 'full_course' | 'spicy' | 'chefs_kiss' | 'burnt_toast'

export interface ResultMoment {
  matchId: number
  kind: MomentKind
  points: number // total points the user earned across all their picks on this match
  homeTeam: number
  awayTeam: number
  homeScore: number
  awayScore: number
}

/** Classify a match's outcome for the user from their picks on it. Priority:
 *  exact hit > doubled upset > any win > miss. */
export function momentKind(matchPicks: MatchPick[]): MomentKind {
  const exact = matchPicks.find((p) => p.market === 'exact_score')
  if (exact && (exact.points_awarded ?? 0) > 0) return 'full_course'
  const outcome = matchPicks.find((p) => p.market === 'outcome')
  if (outcome && (outcome.points_awarded ?? 0) >= 20) return 'spicy' // upset ×2
  const anyWin = matchPicks.some((p) => (p.points_awarded ?? 0) > 0)
  return anyWin ? 'chefs_kiss' : 'burnt_toast'
}

/**
 * Ordered overlays to play (chronological by kickoff, then match id), one per
 * finished match the user picked and hasn't seen yet. Deduped by match id.
 */
export function computeResultMoments(
  picks: MatchPick[],
  matches: MatchRow[],
  seen: Iterable<number>,
): ResultMoment[] {
  const seenSet = new Set(seen)
  const picksByMatch = new Map<number, MatchPick[]>()
  for (const p of picks) {
    const list = picksByMatch.get(p.match_id) ?? []
    list.push(p)
    picksByMatch.set(p.match_id, list)
  }

  const moments: (ResultMoment & { kickoff: string })[] = []
  for (const m of matches) {
    if (m.status !== 'finished' || seenSet.has(m.id)) continue
    const mp = picksByMatch.get(m.id)
    if (!mp || mp.length === 0) continue
    moments.push({
      matchId: m.id,
      kind: momentKind(mp),
      points: mp.reduce((sum, p) => sum + (p.points_awarded ?? 0), 0),
      homeTeam: m.home_team,
      awayTeam: m.away_team,
      homeScore: m.home_score ?? 0,
      awayScore: m.away_score ?? 0,
      kickoff: m.kickoff,
    })
  }

  moments.sort((a, b) =>
    a.kickoff === b.kickoff ? a.matchId - b.matchId : a.kickoff < b.kickoff ? -1 : 1,
  )
  return moments.map(({ kickoff: _kickoff, ...rest }) => rest)
}
