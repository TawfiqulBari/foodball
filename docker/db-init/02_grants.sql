-- ════════════════════════════════════════════════════════════════════════════
-- LOCAL DOCKER ONLY. Mirrors Supabase's default table grants so the `anon` /
-- `authenticated` roles can exercise the schema through RLS. RLS — not these
-- grants — is what actually authorizes rows (grants are the coarse gate; the
-- row-level USING/WITH CHECK policies are the fine gate).
-- ════════════════════════════════════════════════════════════════════════════
grant select on all tables in schema public to anon, authenticated;
grant insert, update, delete on
  public.profiles, public.match_picks, public.round_props, public.tourney_picks
  to authenticated;
-- Admin write paths to reference data go through SECURITY DEFINER RPCs / the
-- admin RLS policies, so authenticated also needs base DML on those tables:
grant insert, update, delete on
  public.teams, public.rounds, public.matches, public.players_catalog, public.decay_schedule
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;
