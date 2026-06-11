import { describe, expect, it } from 'vitest'
import {
  assignSides,
  jerseyColor,
  matchDayTabs,
  roundComplete,
  scoredSide,
  sideForSelection,
  type Picker,
} from './matchField'
import type { MatchRow } from './database.types'

const picker = (id: string): Picker => ({ user_id: id, display_name: id, avatar_config: {} })
const match = (id: number, kickoff: string, status: MatchRow['status'], hs = 0, as_ = 0): MatchRow => ({
  id, api_match_id: `M${id}`, round_key: 'MD1', group_letter: 'A',
  home_team: 1, away_team: 2, kickoff, underdog_team: null, status,
  home_score: hs, away_score: as_, home_score_et: null, away_score_et: null,
  winner: null, result_source: 'api',
})

describe('sideForSelection', () => {
  it('maps home/away/draw', () => {
    expect(sideForSelection('home')).toBe('home')
    expect(sideForSelection('away')).toBe('away')
    expect(sideForSelection('draw')).toBe('draw')
  })
})

describe('assignSides', () => {
  it('splits pickers onto the side they backed', () => {
    const pickers = new Map<string, Picker>([['a', picker('a')], ['b', picker('b')], ['c', picker('c')]])
    const sides = assignSides(
      [{ user_id: 'a', selection: 'home' }, { user_id: 'b', selection: 'away' }, { user_id: 'c', selection: 'draw' }],
      pickers,
    )
    expect(sides.home.map((p) => p.user_id)).toEqual(['a'])
    expect(sides.away.map((p) => p.user_id)).toEqual(['b'])
    expect(sides.draw.map((p) => p.user_id)).toEqual(['c'])
  })
  it('skips picks with no matching profile', () => {
    const sides = assignSides([{ user_id: 'ghost', selection: 'home' }], new Map())
    expect(sides.home).toEqual([])
  })
})

describe('jerseyColor', () => {
  it('is deterministic and team-distinct', () => {
    expect(jerseyColor('ARG')).toBe(jerseyColor('ARG'))
    expect(jerseyColor('ARG')).not.toBe(jerseyColor('BRA'))
    expect(jerseyColor('ARG')).toMatch(/^hsl\(\d+, 68%, 45%\)$/)
  })
})

describe('roundComplete', () => {
  it('true only when every round match has an outcome pick', () => {
    expect(roundComplete([10, 20, 30], [10, 20, 30])).toBe(true)
    expect(roundComplete([10, 20], [10, 20, 30])).toBe(false)
    expect(roundComplete([10, 20, 30, 40], [10, 20, 30])).toBe(true) // extra picks fine
    expect(roundComplete([], [])).toBe(false) // no matches ⇒ not "complete"
  })
})

describe('scoredSide', () => {
  it('detects which side just scored', () => {
    expect(scoredSide({ home_score: 0, away_score: 0 }, { home_score: 1, away_score: 0 })).toBe('home')
    expect(scoredSide({ home_score: 1, away_score: 0 }, { home_score: 1, away_score: 1 })).toBe('away')
    expect(scoredSide({ home_score: 1, away_score: 1 }, { home_score: 1, away_score: 1 })).toBeNull()
    expect(scoredSide(undefined, { home_score: 3, away_score: 0 })).toBeNull() // first load, no celebration
    expect(scoredSide({ home_score: null, away_score: null }, { home_score: 1, away_score: 0 })).toBe('home')
  })
})

describe('matchDayTabs', () => {
  const now = new Date('2026-06-15T18:00:00Z')
  it('prefers live matches', () => {
    const ms = [
      match(1, '2026-06-15T16:00:00Z', 'live'),
      match(2, '2026-06-15T16:00:00Z', 'live'),
      match(3, '2026-06-20T16:00:00Z', 'scheduled'),
    ]
    const { tabs, defaultId } = matchDayTabs(ms, now)
    expect(tabs.map((m) => m.id)).toEqual([1, 2])
    expect(defaultId).toBe(1)
  })
  it('falls back to most-recently-kicked-off when none live', () => {
    const ms = [
      match(1, '2026-06-12T16:00:00Z', 'finished'),
      match(2, '2026-06-14T16:00:00Z', 'finished'),
      match(3, '2026-06-20T16:00:00Z', 'scheduled'),
    ]
    const { defaultId } = matchDayTabs(ms, now)
    expect(defaultId).toBe(2) // the later-kicked-off finished match
  })
  it('falls back to the next upcoming when nothing has started', () => {
    const ms = [match(3, '2026-06-20T16:00:00Z', 'scheduled'), match(4, '2026-06-22T16:00:00Z', 'scheduled')]
    const { tabs, defaultId } = matchDayTabs(ms, now)
    expect(defaultId).toBe(3)
    expect(tabs).toHaveLength(1)
  })
})
