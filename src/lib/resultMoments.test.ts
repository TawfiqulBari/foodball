import { describe, expect, it } from 'vitest'
import { computeResultMoments, momentKind } from './resultMoments'
import type { MatchPick, MatchRow } from './database.types'

const pick = (matchId: number, market: MatchPick['market'], pts: number | null): MatchPick => ({
  id: Math.floor(Math.random() * 1e9),
  user_id: 'u',
  match_id: matchId,
  market,
  selection: 'x',
  created_at: '2026-06-11T00:00:00Z',
  points_awarded: pts,
})

const match = (id: number, kickoff: string, status: MatchRow['status'] = 'finished'): MatchRow => ({
  id,
  api_match_id: `M${id}`,
  round_key: 'MD1',
  group_letter: 'A',
  home_team: 1,
  away_team: 2,
  kickoff,
  underdog_team: null,
  status,
  home_score: 2,
  away_score: 1,
  home_score_et: null,
  away_score_et: null,
  winner: null,
  result_source: 'manual',
})

describe('momentKind — priority full_course > spicy > chefs_kiss > burnt_toast', () => {
  it('exact-score hit ⇒ full_course (even if outcome also won)', () => {
    expect(momentKind([pick(1, 'exact_score', 25), pick(1, 'outcome', 10)])).toBe('full_course')
  })
  it('doubled upset outcome (20) ⇒ spicy', () => {
    expect(momentKind([pick(1, 'outcome', 20)])).toBe('spicy')
  })
  it('plain correct outcome (10) ⇒ chefs_kiss', () => {
    expect(momentKind([pick(1, 'outcome', 10)])).toBe('chefs_kiss')
  })
  it('only a side market won ⇒ chefs_kiss', () => {
    expect(momentKind([pick(1, 'outcome', 0), pick(1, 'btts', 5)])).toBe('chefs_kiss')
  })
  it('nothing won ⇒ burnt_toast', () => {
    expect(momentKind([pick(1, 'outcome', 0), pick(1, 'btts', 0)])).toBe('burnt_toast')
  })
})

describe('computeResultMoments — the queue (M4 acceptance)', () => {
  it('a batch of 3 finished picked matches yields 3 ordered moments', () => {
    const picks = [pick(10, 'outcome', 10), pick(20, 'exact_score', 25), pick(30, 'outcome', 0)]
    const matches = [
      match(30, '2026-06-13T16:00:00Z'),
      match(10, '2026-06-11T16:00:00Z'),
      match(20, '2026-06-12T16:00:00Z'),
    ]
    const moments = computeResultMoments(picks, matches, [])
    expect(moments.map((m) => m.matchId)).toEqual([10, 20, 30]) // chronological by kickoff
    expect(moments.map((m) => m.kind)).toEqual(['chefs_kiss', 'full_course', 'burnt_toast'])
  })

  it('dedups against the seen set', () => {
    const picks = [pick(10, 'outcome', 10), pick(20, 'outcome', 20)]
    const matches = [match(10, '2026-06-11T16:00:00Z'), match(20, '2026-06-12T16:00:00Z')]
    const moments = computeResultMoments(picks, matches, [10])
    expect(moments.map((m) => m.matchId)).toEqual([20])
    expect(moments[0]!.kind).toBe('spicy')
  })

  it('ignores unfinished matches and matches with no pick', () => {
    const picks = [pick(10, 'outcome', 10)]
    const matches = [
      match(10, '2026-06-11T16:00:00Z', 'live'), // picked but not finished
      match(99, '2026-06-11T16:00:00Z'), // finished but no pick
    ]
    expect(computeResultMoments(picks, matches, [])).toEqual([])
  })

  it('sums points across all of a match’s picks', () => {
    const picks = [pick(10, 'outcome', 10), pick(10, 'exact_score', 25), pick(10, 'btts', 5)]
    const moments = computeResultMoments(picks, [match(10, '2026-06-11T16:00:00Z')], [])
    expect(moments).toHaveLength(1)
    expect(moments[0]!.points).toBe(40)
    expect(moments[0]!.kind).toBe('full_course')
  })
})
