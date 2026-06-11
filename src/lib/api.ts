import { supabase } from './supabase'
import type { LeaderboardRow, MatchPick, MatchRow, Outcome, RoundRow, Team } from './database.types'

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

/** The current user's picks, keyed by `${match_id}:${market}`. */
export async function fetchMyPicks(): Promise<Map<string, MatchPick>> {
  const { data, error } = await supabase.from('match_picks').select('*')
  if (error) throw error
  return new Map((data ?? []).map((p) => [`${p.match_id}:${p.market}`, p]))
}

/** Submit/replace an outcome pick. The DB lock trigger is the real guard; the
 *  client-side lock check is only to avoid a guaranteed-to-fail round trip. */
export async function submitOutcomePick(
  userId: string,
  matchId: number,
  selection: Outcome,
): Promise<void> {
  const { error } = await supabase
    .from('match_picks')
    .upsert(
      { user_id: userId, match_id: matchId, market: 'outcome', selection },
      { onConflict: 'user_id,match_id,market' },
    )
  if (error) throw error
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  const { data, error } = await supabase.from('leaderboard').select('*').order('rank')
  if (error) throw error
  return data ?? []
}

export async function adminSetResult(args: {
  matchId: number
  home: number
  away: number
  winner?: number | null
}): Promise<void> {
  const { error } = await supabase.rpc('fb_admin_set_result', {
    p_match_id: args.matchId,
    p_home: args.home,
    p_away: args.away,
    p_winner: args.winner ?? null,
  })
  if (error) throw error
}
