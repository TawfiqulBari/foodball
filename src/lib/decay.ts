// Tournament-long pick decay (spec §4.3).
//
// The points a tournament-long pick (Champion, Golden Boot…) is worth depend on
// *when the currently-held pick was last set* — the longer you wait, the less it
// pays. This module is the PURE computation used for display ("Champion: ARG —
// worth 70 pts if correct") and is the M2 mandatory unit test (spec §10).
//
// Authoritative scoring also runs in Postgres (`fb_score_tournament`). Both sides
// read the same `decay_schedule` table so they can never drift — this module
// never hard-codes the points; it looks them up in the schedule rows it is given.

export type TourneyPickType =
  | 'champion'
  | 'finalist'
  | 'golden_boot'
  | 'golden_glove'
  | 'young_player'
  | 'total_goals'

// The decay "bucket" stored in both `tourney_picks.set_after_round` and
// `decay_schedule.set_after_round`. `null` = pre-tournament ("Before MD1");
// 'MD3' represents the whole group stage ("After MD1–MD3" — the §4.3 table has
// one column for all three matchdays); knockout rounds are each their own bucket.
export type DecayBucket = null | 'MD3' | 'R32' | 'R16' | 'QF' | 'SF'

export interface DecayRow {
  pick_type: string
  set_after_round: string | null
  points: number
}

/**
 * Map the latest *completed* round to its decay bucket. Group-stage rounds all
 * collapse to the single "After MD1–MD3" column (stored as 'MD3'); this matches
 * the seeded `decay_schedule` (which has only an 'MD3' row for the group stage).
 * Idempotent for values that are already buckets (`decayBucket('MD3') === 'MD3'`),
 * so it is safe to call on a stored `set_after_round`.
 */
export function decayBucket(latestCompletedRound: string | null | undefined): DecayBucket {
  switch (latestCompletedRound) {
    case 'MD1':
    case 'MD2':
    case 'MD3':
      return 'MD3'
    case 'R32':
      return 'R32'
    case 'R16':
      return 'R16'
    case 'QF':
      return 'QF'
    case 'SF':
    case 'F': // nothing pays later than "After SF"; the final settles the picks
      return 'SF'
    default:
      return null // null / undefined / unknown ⇒ pre-tournament
  }
}

/**
 * Points a currently-held pick is worth, given the round after which it was set.
 * `schedule` is the set of `decay_schedule` rows (from the DB). Returns 0 when
 * that (type, bucket) pair is not scorable — the "—" cells in §4.3, e.g. a
 * finalist pick first set after SF, or a total-goals pick set after the group
 * stage. `setAfterRound` may be a raw round key or an already-bucketed value.
 */
export function decayedPoints(
  schedule: readonly DecayRow[],
  pickType: TourneyPickType,
  setAfterRound: string | null | undefined,
): number {
  const bucket = decayBucket(setAfterRound)
  const row = schedule.find(
    (r) => r.pick_type === pickType && decayBucket(r.set_after_round) === bucket,
  )
  return row?.points ?? 0
}

/**
 * Canonical §4.3 decay table as schedule rows. This is the single source the
 * Postgres `decay_schedule` seed mirrors; keep the two identical. Buckets use
 * the same encoding as the DB (`null` pre-tournament, `'MD3'` for the group
 * stage). Cells marked "—" in the spec are simply absent (⇒ `decayedPoints`
 * returns 0).
 */
export const DECAY_SCHEDULE_SEED: readonly DecayRow[] = [
  { pick_type: 'champion', set_after_round: null, points: 100 },
  { pick_type: 'champion', set_after_round: 'MD3', points: 70 },
  { pick_type: 'champion', set_after_round: 'R32', points: 50 },
  { pick_type: 'champion', set_after_round: 'R16', points: 35 },
  { pick_type: 'champion', set_after_round: 'QF', points: 20 },
  { pick_type: 'champion', set_after_round: 'SF', points: 10 },

  { pick_type: 'finalist', set_after_round: null, points: 40 },
  { pick_type: 'finalist', set_after_round: 'MD3', points: 30 },
  { pick_type: 'finalist', set_after_round: 'R32', points: 20 },
  { pick_type: 'finalist', set_after_round: 'R16', points: 15 },
  { pick_type: 'finalist', set_after_round: 'QF', points: 8 },
  // finalist after SF: "—" (both finalists already known) ⇒ no row

  { pick_type: 'golden_boot', set_after_round: null, points: 50 },
  { pick_type: 'golden_boot', set_after_round: 'MD3', points: 35 },
  { pick_type: 'golden_boot', set_after_round: 'R32', points: 25 },
  { pick_type: 'golden_boot', set_after_round: 'R16', points: 18 },
  { pick_type: 'golden_boot', set_after_round: 'QF', points: 10 },
  { pick_type: 'golden_boot', set_after_round: 'SF', points: 5 },

  { pick_type: 'golden_glove', set_after_round: null, points: 40 },
  { pick_type: 'golden_glove', set_after_round: 'MD3', points: 28 },
  { pick_type: 'golden_glove', set_after_round: 'R32', points: 20 },
  { pick_type: 'golden_glove', set_after_round: 'R16', points: 14 },
  { pick_type: 'golden_glove', set_after_round: 'QF', points: 8 },
  { pick_type: 'golden_glove', set_after_round: 'SF', points: 4 },

  { pick_type: 'young_player', set_after_round: null, points: 30 },
  { pick_type: 'young_player', set_after_round: 'MD3', points: 20 },
  { pick_type: 'young_player', set_after_round: 'R32', points: 15 },
  { pick_type: 'young_player', set_after_round: 'R16', points: 10 },
  { pick_type: 'young_player', set_after_round: 'QF', points: 6 },
  { pick_type: 'young_player', set_after_round: 'SF', points: 3 },

  { pick_type: 'total_goals', set_after_round: null, points: 30 },
  { pick_type: 'total_goals', set_after_round: 'MD3', points: 20 },
  // total_goals after R32+: "—" ⇒ no row
] as const
