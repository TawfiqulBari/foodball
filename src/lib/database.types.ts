// Hand-maintained for M1. Regenerate from the live schema later with:
//   npx supabase gen types typescript --local > src/lib/database.types.ts
// Kept intentionally narrow to what M1 reads/writes.

export type Outcome = 'home' | 'draw' | 'away'
export type MatchStatus = 'scheduled' | 'live' | 'finished'
export type Market = 'outcome' | 'exact_score' | 'btts' | 'over_under'
export type Prop = 'top_chef' | 'clean_plate' | 'spice'
export type TourneyPickType =
  | 'champion'
  | 'finalist'
  | 'golden_boot'
  | 'golden_glove'
  | 'young_player'
  | 'total_goals'

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

export interface PlayerCatalog {
  id: number
  api_player_id: string | null
  name: string
  team: number | null
  position: string | null
}

export interface RoundProp {
  id: number
  user_id: string
  round_key: string
  prop: Prop
  selection: string
  created_at: string
  points_awarded: number | null
}

export interface TourneyPick {
  id: number
  user_id: string
  pick_type: TourneyPickType
  selection: string
  set_after_round: string | null
  superseded_by: number | null
  created_at: string
  points_awarded: number | null
}

export interface DecayRow {
  pick_type: string
  set_after_round: string | null
  points: number
}

export type CommentaryKind = 'note' | 'goal' | 'card' | 'ht' | 'ft' | 'ko'
export interface MatchCommentary {
  id: number
  match_id: number
  minute: number | null
  body: string
  kind: CommentaryKind
  created_at: string
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
      round_props: {
        Row: RoundProp
        Insert: { user_id: string; round_key: string; prop: Prop; selection: string }
        Update: Partial<Pick<RoundProp, 'selection'>>
      }
      tourney_picks: {
        Row: TourneyPick
        Insert: { user_id: string; pick_type: TourneyPickType; selection: string }
        Update: Partial<Pick<TourneyPick, 'superseded_by'>>
      }
      players_catalog: { Row: PlayerCatalog; Insert: Partial<PlayerCatalog>; Update: Partial<PlayerCatalog> }
      decay_schedule: { Row: DecayRow; Insert: Partial<DecayRow>; Update: Partial<DecayRow> }
      round_top_scorers: {
        Row: { round_key: string; player_id: number }
        Insert: { round_key: string; player_id: number }
        Update: Partial<{ round_key: string; player_id: number }>
      }
      tournament_results: {
        Row: { pick_type: string; selection: string }
        Insert: { pick_type: string; selection: string }
        Update: Partial<{ pick_type: string; selection: string }>
      }
      match_commentary: {
        Row: MatchCommentary
        Insert: Partial<MatchCommentary> & { match_id: number; body: string }
        Update: Partial<MatchCommentary>
      }
      settings: {
        Row: { id: boolean; longshot_grace_until: string | null }
        Insert: { id?: boolean; longshot_grace_until?: string | null }
        Update: Partial<{ longshot_grace_until: string | null }>
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
      fb_set_tourney_pick: { Args: { p_pick_type: TourneyPickType; p_selection: string }; Returns: number }
      fb_admin_settle_round: {
        Args: { p_round_key: string; p_top_scorer_ids?: number[]; p_mark_complete?: boolean }
        Returns: void
      }
      fb_admin_set_tournament_result: { Args: { p_pick_type: string; p_selection: string }; Returns: void }
      fb_admin_post_commentary: {
        Args: { p_match_id: number; p_body: string; p_minute?: number | null; p_kind?: string }
        Returns: number
      }
      fb_admin_set_longshot_grace: { Args: { p_until: string | null }; Returns: void }
      fb_longshot_grace_active: { Args: Record<string, never>; Returns: boolean }
      fb_tourney_revision_open: { Args: Record<string, never>; Returns: boolean }
    }
  }
}
