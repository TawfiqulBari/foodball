import { describe, expect, it } from 'vitest'
import {
  DECAY_SCHEDULE_SEED,
  decayBucket,
  decayedPoints,
  type DecayRow,
  type TourneyPickType,
} from './decay'

// ─────────────────────────────────────────────────────────────────────────────
// The spec §4.3 table, transcribed verbatim. Columns are the "when last set"
// buckets; `null` marks a "—" cell (not scorable if first set that late).
//
// | Pick          | Before MD1 | After MD1–MD3 | After R32 | After R16 | After QF | After SF |
// | Champion      | 100        | 70            | 50        | 35        | 20       | 10       |
// | Finalist each | 40         | 30            | 20        | 15        | 8        | —        |
// | Golden Boot   | 50         | 35            | 25        | 18        | 10       | 5        |
// | Golden Glove  | 40         | 28            | 20        | 14        | 8        | 4        |
// | Young Player  | 30         | 20            | 15        | 10        | 6        | 3        |
// | Total goals   | 30         | 20            | —         | —         | —        | —        |
// ─────────────────────────────────────────────────────────────────────────────

const COLUMNS: { label: string; bucket: string | null; representativeRound: string | null }[] = [
  { label: 'Before MD1', bucket: null, representativeRound: null },
  { label: 'After MD1–MD3', bucket: 'MD3', representativeRound: 'MD3' },
  { label: 'After R32', bucket: 'R32', representativeRound: 'R32' },
  { label: 'After R16', bucket: 'R16', representativeRound: 'R16' },
  { label: 'After QF', bucket: 'QF', representativeRound: 'QF' },
  { label: 'After SF', bucket: 'SF', representativeRound: 'SF' },
]

// `null` === the "—" cells.
const SPEC_4_3: Record<TourneyPickType, (number | null)[]> = {
  champion: [100, 70, 50, 35, 20, 10],
  finalist: [40, 30, 20, 15, 8, null],
  golden_boot: [50, 35, 25, 18, 10, 5],
  golden_glove: [40, 28, 20, 14, 8, 4],
  young_player: [30, 20, 15, 10, 6, 3],
  total_goals: [30, 20, null, null, null, null],
}

const PICK_TYPES = Object.keys(SPEC_4_3) as TourneyPickType[]

describe('decayedPoints — every cell of spec §4.3', () => {
  for (const pickType of PICK_TYPES) {
    for (let col = 0; col < COLUMNS.length; col++) {
      const { label, representativeRound } = COLUMNS[col]!
      const expected = SPEC_4_3[pickType][col]
      it(`${pickType} · ${label} ⇒ ${expected ?? '— (0)'}`, () => {
        // A "—" cell is not scorable: the pure fn returns 0.
        const want = expected ?? 0
        expect(decayedPoints(DECAY_SCHEDULE_SEED, pickType, representativeRound)).toBe(want)
      })
    }
  }
})

describe('group-stage bucketing — MD1/MD2/MD3 all map to "After MD1–MD3"', () => {
  for (const round of ['MD1', 'MD2', 'MD3'] as const) {
    it(`champion set after ${round} ⇒ 70`, () => {
      expect(decayedPoints(DECAY_SCHEDULE_SEED, 'champion', round)).toBe(70)
    })
    it(`total_goals set after ${round} ⇒ 20`, () => {
      expect(decayedPoints(DECAY_SCHEDULE_SEED, 'total_goals', round)).toBe(20)
    })
  }
})

describe('decayBucket', () => {
  it('pre-tournament is null', () => {
    expect(decayBucket(null)).toBeNull()
    expect(decayBucket(undefined)).toBeNull()
  })
  it('group-stage rounds collapse to MD3', () => {
    expect(decayBucket('MD1')).toBe('MD3')
    expect(decayBucket('MD2')).toBe('MD3')
    expect(decayBucket('MD3')).toBe('MD3')
  })
  it('knockout rounds are their own bucket', () => {
    expect(decayBucket('R32')).toBe('R32')
    expect(decayBucket('R16')).toBe('R16')
    expect(decayBucket('QF')).toBe('QF')
    expect(decayBucket('SF')).toBe('SF')
  })
  it('nothing pays later than "After SF" — the final maps to SF', () => {
    expect(decayBucket('F')).toBe('SF')
  })
  it('unknown round keys fall back to pre-tournament', () => {
    expect(decayBucket('XYZ')).toBeNull()
  })
})

describe('"—" cells are explicitly unscorable (0), not the next-best value', () => {
  it('finalist after SF ⇒ 0 (both finalists already known)', () => {
    expect(decayedPoints(DECAY_SCHEDULE_SEED, 'finalist', 'SF')).toBe(0)
    expect(decayedPoints(DECAY_SCHEDULE_SEED, 'finalist', 'F')).toBe(0)
  })
  it('total_goals after the group stage ⇒ 0', () => {
    for (const r of ['R32', 'R16', 'QF', 'SF', 'F']) {
      expect(decayedPoints(DECAY_SCHEDULE_SEED, 'total_goals', r)).toBe(0)
    }
  })
})

describe('DECAY_SCHEDULE_SEED integrity (it must mirror the DB seed / §4.3)', () => {
  it('has no duplicate (pick_type, bucket) rows', () => {
    const keys = DECAY_SCHEDULE_SEED.map((r) => `${r.pick_type}:${r.set_after_round}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
  it('contains exactly the scorable cells of §4.3 and nothing more', () => {
    const scorableCells = PICK_TYPES.reduce(
      (n, pt) => n + SPEC_4_3[pt].filter((v) => v !== null).length,
      0,
    )
    expect(DECAY_SCHEDULE_SEED.length).toBe(scorableCells)
  })
  it('every seed row matches its §4.3 value', () => {
    for (const row of DECAY_SCHEDULE_SEED as DecayRow[]) {
      const col = COLUMNS.findIndex((c) => c.bucket === row.set_after_round)
      expect(col, `unexpected bucket ${row.set_after_round}`).toBeGreaterThanOrEqual(0)
      expect(SPEC_4_3[row.pick_type as TourneyPickType][col]).toBe(row.points)
    }
  })
})
