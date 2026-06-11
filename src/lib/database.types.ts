// Hand-maintained for M1. Regenerate from the live schema later with:
//   npx supabase gen types typescript --local > src/lib/database.types.ts
// Kept intentionally narrow to what M1 reads/writes.

export type Outcome = 'home' | 'draw' | 'away'
export type MatchStatus = 'scheduled' | 'live' | 'finished'
export type Market = 'outcome' | 'exact_score' | 'btts' | 'over_under'

export interface Team {
  id: number
  name: string
  fifa_code: string
  fifa_rank: number | null
  group_letter: string | null
  flag_emoji: string | null
}

export interface RoundRow {
  key: string
  name: string
  first_kickoff: string | null
  completed: boolean
  sort_order: number
}

export interface MatchRow {
  id: number
  api_match_id: string | null
  round_key: string
  group_letter: string | null
  home_team: number
  away_team: number
  kickoff: string
  underdog_team: number | null
  status: MatchStatus
  home_score: number | null
  away_score: number | null
  home_score_et: number | null
  away_score_et: number | null
  winner: number | null
  result_source: 'api' | 'manual' | null
}

export interface MatchPick {
  id: number
  user_id: string
  match_id: number
  market: Market
  selection: string
  created_at: string
  points_awarded: number | null
}

export interface Profile {
  id: string
  display_name: string
  avatar_config: Record<string, unknown>
  is_admin: boolean
  created_at: string
}

export interface LeaderboardRow {
  user_id: string
  display_name: string
  avatar_config: Record<string, unknown>
  total: number
  exact_hits: number
  outcome_hits: number
  rank: number
  rank_delta: number
}

// Minimal shape the supabase-js generic expects.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile> & { id: string; display_name: string }; Update: Partial<Profile> }
      teams: { Row: Team; Insert: Partial<Team>; Update: Partial<Team> }
      rounds: { Row: RoundRow; Insert: Partial<RoundRow>; Update: Partial<RoundRow> }
      matches: { Row: MatchRow; Insert: Partial<MatchRow>; Update: Partial<MatchRow> }
      match_picks: {
        Row: MatchPick
        Insert: { user_id: string; match_id: number; market: Market; selection: string }
        Update: Partial<Pick<MatchPick, 'selection'>>
      }
    }
    Views: {
      leaderboard: { Row: LeaderboardRow }
    }
    Functions: {
      fb_admin_set_result: {
        Args: {
          p_match_id: number
          p_home: number
          p_away: number
          p_home_et?: number | null
          p_away_et?: number | null
          p_winner?: number | null
        }
        Returns: void
      }
      fb_admin_set_underdog: { Args: { p_match_id: number; p_team_id: number }; Returns: void }
    }
  }
}
