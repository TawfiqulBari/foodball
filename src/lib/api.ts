import { supabase } from './supabase'
import type {
  DecayRow,
  LeaderboardRow,
  Market,
  MatchCommentary,
  MatchPick,
  MatchRow,
  Outcome,
  PlayerCatalog,
  Profile,
  Prop,
  RedCard,
  RoundProp,
  RoundScoreRow,
  RoundRow,
  Team,
  TourneyPick,
  TourneyPickType,
} from './database.types'

export async function fetchRounds(): Promise<RoundRow[]> {
  const { data, error } = await supabase.from('rounds').select('*').order('sort_order')
  if (error) throw error
  return data ?? []
}

export async function fetchTeams(): Promise<Map<number, Team>> {
  const { data, error } = await supabase.from('teams').select('*')
  if (error) throw error
  return new Map((data ?? []).map((t) => [t.id, t]))
}

export async function fetchMatches(roundKey: string): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .from('matches')
    .select('*')
    .eq('round_key', roundKey)
    .order('kickoff')
  if (error) throw error
  return data ?? []
}

/** The signed-in user's id (from the locally-cached session — no network call). */
async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/** The current user's picks, keyed by `${match_id}:${market}`. MUST filter by
 *  user_id explicitly: RLS reveals EVERYONE's picks after kickoff (for the Stadium),
 *  so without this filter a started match returns all players' picks and the Map
 *  collides on `match_id:market` — showing a random rival's pick as "yours". */
export async function fetchMyPicks(): Promise<Map<string, MatchPick>> {
  const uid = await currentUserId()
  if (!uid) return new Map()
  const { data, error } = await supabase.from('match_picks').select('*').eq('user_id', uid)
  if (error) throw error
  return new Map((data ?? []).map((p) => [`${p.match_id}:${p.market}`, p]))
}

/** Submit/replace an outcome pick. The DB lock trigger is the real guard; the
 *  client-side lock check is only to avoid a guaranteed-to-fail round trip. */
export async function submitMatchPick(
  userId: string,
  matchId: number,
  market: Market,
  selection: string,
): Promise<void> {
  const { error } = await supabase
    .from('match_picks')
    .upsert(
      { user_id: userId, match_id: matchId, market, selection },
      { onConflict: 'user_id,match_id,market' },
    )
  if (error) throw error
}

/** Convenience wrapper for the outcome market (the common case). */
export async function submitOutcomePick(
  userId: string,
  matchId: number,
  selection: Outcome,
): Promise<void> {
  return submitMatchPick(userId, matchId, 'outcome', selection)
}

/** A given user's match picks (all markets). RLS reveals another user's pick only
 *  after that match's kickoff, so expanding a rival on The Food Chain can never leak
 *  a not-yet-locked pick. Your own picks are always returned. */
export async function fetchMatchPicksForUser(userId: string): Promise<MatchPick[]> {
  const { data, error } = await supabase.from('match_picks').select('*').eq('user_id', userId)
  if (error) throw error
  return data ?? []
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.from('leaderboard').select('*').order('rank')
  if (error) throw error
  return data ?? []
}

// ─── Match Day pitch ─────────────────────────────────────────────────────────

/** Every match, ordered by kickoff — Match Day derives its live/recent tabs. */
export async function fetchAllMatches(): Promise<MatchRow[]> {
  const { data, error } = await supabase.from('matches').select('*').order('kickoff')
  if (error) throw error
  return data ?? []
}

/** All outcome pickers for a match. RLS reveals others' picks only after kickoff,
 *  so this is fully populated exactly when the pitch is live (post-lock). */
export async function fetchOutcomePickers(
  matchId: number,
): Promise<{ user_id: string; selection: string }[]> {
  const { data, error } = await supabase
    .from('match_picks')
    .select('user_id, selection')
    .eq('match_id', matchId)
    .eq('market', 'outcome')
  if (error) throw error
  return (data ?? []).map((r) => ({ user_id: r.user_id, selection: r.selection }))
}

export async function fetchProfilesByIds(ids: string[]): Promise<Map<string, Profile>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.from('profiles').select('*').in('id', ids)
  if (error) throw error
  return new Map((data ?? []).map((p) => [p.id, p]))
}

// ─── Live commentary ─────────────────────────────────────────────────────────

export async function fetchCommentary(matchId: number): Promise<MatchCommentary[]> {
  const { data, error } = await supabase
    .from('match_commentary')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
    .limit(60)
  if (error) throw error
  return data ?? []
}

export async function adminPostCommentary(
  matchId: number,
  body: string,
  minute?: number | null,
  kind = 'note',
): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_post_commentary', {
    p_match_id: matchId,
    p_body: body,
    p_minute: minute ?? null,
    p_kind: kind,
  })
  if (error) throw error
}

// ─── Reference data ──────────────────────────────────────────────────────────

export async function fetchPlayers(): Promise<PlayerCatalog[]> {
  const { data, error } = await supabase.from('players_catalog').select('*').order('name')
  if (error) throw error
  return data ?? []
}

/** Per-player, per-round points (migration 0027) for the public final score card.
 *  `round_key` is a real round, or 'LONG' for the tournament long-shot payouts. */
export async function fetchRoundScorecard(): Promise<RoundScoreRow[]> {
  const { data, error } = await supabase.from('round_scorecard').select('*')
  if (error) throw error
  return data ?? []
}

/** EVERY player's round specials. RLS reveals others' round props only once the round
 *  has locked — every round is complete now, so this is the full picture. */
export async function fetchAllRoundProps(): Promise<RoundProp[]> {
  const { data, error } = await supabase.from('round_props').select('*')
  if (error) throw error
  return data ?? []
}

/** Decay schedule rows (spec §4.3) — the single source The Menu + the decayed
 *  value display read from, so they never drift from the authoritative scorer. */
export async function fetchDecaySchedule(): Promise<DecayRow[]> {
  const { data, error } = await supabase.from('decay_schedule').select('*')
  if (error) throw error
  return data ?? []
}

// ─── Round props (Top Chef / Clean Plate / Spice) ────────────────────────────

/** The current user's round-prop picks for a round, keyed by prop. Filters by
 *  user_id: RLS reveals everyone's round props after the round's first kickoff, so
 *  without this the per-prop Map would collide on another player's pick. */
export async function fetchMyRoundProps(roundKey: string): Promise<Map<Prop, RoundProp>> {
  const uid = await currentUserId()
  if (!uid) return new Map()
  const { data, error } = await supabase
    .from('round_props')
    .select('*')
    .eq('round_key', roundKey)
    .eq('user_id', uid)
  if (error) throw error
  return new Map((data ?? []).map((p) => [p.prop, p]))
}

export async function submitRoundProp(
  userId: string,
  roundKey: string,
  prop: Prop,
  selection: string,
): Promise<void> {
  const { error } = await supabase
    .from('round_props')
    .upsert(
      { user_id: userId, round_key: roundKey, prop, selection },
      { onConflict: 'user_id,round_key,prop' },
    )
  if (error) throw error
}

// ─── Tournament-long picks (with decay + revision history) ───────────────────

/** All of the current user's tournament picks (full revision history), newest
 *  first. The active pick per type is the first one of that type. Filters by
 *  user_id: RLS reveals others' tourney picks once locked, so this must scope to
 *  the signed-in user or the "my picks" list would include rivals' picks. */
export async function fetchMyTourneyPicks(): Promise<TourneyPick[]> {
  const uid = await currentUserId()
  if (!uid) return []
  // Active pick per type = highest id (matches the server scorer, which ranks by
  // the immutable identity column, not the now-server-stamped created_at).
  const { data, error } = await supabase
    .from('tourney_picks')
    .select('*')
    .eq('user_id', uid)
    .order('id', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Set/revise a tournament pick. Server stamps the decay bucket + enforces the
 *  revision window; a closed window throws. Returns the new pick id. */
export async function setTourneyPick(pickType: TourneyPickType, selection: string): Promise<number> {
  const { data, error } = await supabase.rpc('fb_set_tourney_pick', {
    p_pick_type: pickType,
    p_selection: selection,
  })
  if (error) throw error
  return data as number
}

export async function isRevisionWindowOpen(): Promise<boolean> {
  const { data, error } = await supabase.rpc('fb_tourney_revision_open', {})
  if (error) throw error
  return Boolean(data)
}

/** The long-shot launch-grace cut-off (ISO) or null. While now() < this, long
 *  shots are open to everyone at full pre-tournament value. */
export async function fetchLongshotGrace(): Promise<string | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('longshot_grace_until')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  return data?.longshot_grace_until ?? null
}

export async function adminSetLongshotGrace(until: string | null): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_set_longshot_grace', { p_until: until })
  if (error) throw error
}

/** The round-specials launch-grace cut-off (ISO) or null. While now() < this,
 *  round props (Top Chef / Clean Plate / Spice) stay open despite a passed
 *  kickoff — used because the league launched after MD1 had already started. */
export async function fetchRoundPropsGrace(): Promise<string | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('round_props_grace_until')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  return data?.round_props_grace_until ?? null
}

export async function adminSetRoundPropsGrace(until: string | null): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_set_round_props_grace', { p_until: until })
  if (error) throw error
}

export interface TwoPhaseConfig {
  enabled: boolean
  groupWeight: number
  knockoutWeight: number
}

/** Two-phase scoring config (migration 0022). When enabled, the leaderboard total
 *  is a 0–100 weighted blend of a frozen group-stage score and a live knockout
 *  score; when off, it's the raw cumulative points. Weights are numeric in PG, so
 *  they arrive as strings — coerce them. */
export async function fetchTwoPhase(): Promise<TwoPhaseConfig> {
  const { data, error } = await supabase
    .from('settings')
    .select('two_phase_enabled, group_weight, knockout_weight')
    .eq('id', true)
    .maybeSingle()
  if (error) throw error
  return {
    enabled: data?.two_phase_enabled ?? false,
    groupWeight: Number(data?.group_weight ?? 0.3),
    knockoutWeight: Number(data?.knockout_weight ?? 0.7),
  }
}

// Match picks lock at kickoff (no grace) — see migration 0016. The match-pick
// grace RPC/column remain in the DB for back-compat but are inert, so there is
// no client wrapper for them anymore.

// ─── Red cards (voided post-kickoff picks) ───────────────────────────────────

/** Every red card (a voided pick + the points it cost), newest first. Readable
 *  by everyone — the "Red Cards" page is intentionally public/transparent. */
export async function fetchRedCards(): Promise<RedCard[]> {
  const { data, error } = await supabase
    .from('red_cards')
    .select('*')
    .order('points_deducted', { ascending: false })
    .order('picked_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// ─── Signup domain allowlist (admin) ─────────────────────────────────────────

/** The email domains allowed to sign up. Readable only by an admin (RLS). */
export async function fetchSignupDomains(): Promise<string[]> {
  const { data, error } = await supabase
    .from('signup_allowed_domains')
    .select('domain')
    .order('domain')
  if (error) throw error
  return (data ?? []).map((r) => r.domain)
}

export async function adminAddSignupDomain(domain: string): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_add_signup_domain', { p_domain: domain })
  if (error) throw error
}

export async function adminRemoveSignupDomain(domain: string): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_remove_signup_domain', { p_domain: domain })
  if (error) throw error
}

// ─── Profile (onboarding + avatar) ───────────────────────────────────────────

export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'display_name' | 'avatar_config'>>,
): Promise<void> {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  if (error) throw error
}

// ─── Admin ───────────────────────────────────────────────────────────────────

export async function adminSetResult(args: {
  matchId: number
  home: number
  away: number
  homeEt?: number | null
  awayEt?: number | null
  winner?: number | null
}): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_set_result', {
    p_match_id: args.matchId,
    p_home: args.home,
    p_away: args.away,
    p_home_et: args.homeEt ?? null,
    p_away_et: args.awayEt ?? null,
    p_winner: args.winner ?? null,
  })
  if (error) throw error
}

export async function adminSetUnderdog(matchId: number, teamId: number | null): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_set_underdog', {
    p_match_id: matchId,
    p_team_id: teamId as number,
  })
  if (error) throw error
}

export async function adminSettleRound(
  roundKey: string,
  topScorerIds: number[],
  markComplete: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_settle_round', {
    p_round_key: roundKey,
    p_top_scorer_ids: topScorerIds,
    p_mark_complete: markComplete,
  })
  if (error) throw error
}

export async function adminSetTournamentResult(pickType: string, selection: string): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_set_tournament_result', {
    p_pick_type: pickType,
    p_selection: selection,
  })
  if (error) throw error
}

/** Tune a decay value (spec §4.3 is admin-editable). RLS allows admins only. */
export async function adminUpdateDecay(
  pickType: string,
  setAfterRound: string | null,
  points: number,
): Promise<void> {
  const base = supabase.from('decay_schedule').update({ points }).eq('pick_type', pickType)
  const { error } =
    setAfterRound === null
      ? await base.is('set_after_round', null)
      : await base.eq('set_after_round', setAfterRound)
  if (error) throw error
}
