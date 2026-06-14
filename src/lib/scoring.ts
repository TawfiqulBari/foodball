// Fixed point values (spec §4.1–4.2), mirrored from the authoritative Postgres
// scorer (fb_score_match / fb_score_round in 0002_*.sql). The Menu renders these
// rather than a hand-written prose copy, so the rules page can't drift from the
// numbers the UI quotes. Tournament-pick values are NOT here — those live in the
// decay_schedule table and are read live (spec §4.3, the only tunable values).

export const MARKET_POINTS = {
  outcome: 10,
  exact_score: 25, // its own market, scored independently of the outcome pick
  btts: 5,
  over_under: 5,
} as const

export const UPSET_MULTIPLIER = 2 // outcome ×2 when the picked winner is the underdog

export const PROP_POINTS = {
  spice: 20, // Spice of the Round — underdog upset
  top_chef: 15, // Top Chef — round top scorer
  clean_plate: 10, // Clean Plate — clean-sheet keeper
} as const

// Decay buckets in display order; labels match the spec §4.3 columns.
export const DECAY_BUCKETS: { key: string | null; label: string }[] = [
  { key: null, label: 'Before MD1' },
  { key: 'MD3', label: 'MD1–MD3' },
  { key: 'R32', label: 'R32' },
  { key: 'R16', label: 'R16' },
  { key: 'QF', label: 'QF' },
  { key: 'SF', label: 'SF' },
]

export const TOURNEY_PICK_LABELS: Record<string, string> = {
  champion: 'Champion',
  finalist: 'Finalist',
  golden_boot: 'Golden Boot',
  golden_glove: 'Golden Glove',
  young_player: 'Young Player',
  total_goals: 'Total goals (±5)',
}
