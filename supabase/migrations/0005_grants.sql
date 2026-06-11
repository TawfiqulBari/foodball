-- ════════════════════════════════════════════════════════════════════════════
-- Base table privileges for the PostgREST request roles (anon / authenticated).
--
-- RLS is the row-level authorization gate; these are the COARSE table-level
-- grants PostgREST needs before RLS is even consulted (without them you get
-- "permission denied for table"). On the local Docker harness this is supplied by
-- docker/db-init/02_grants.sql; on a real Supabase project that shim is NOT
-- applied, so this migration supplies the SAME grants there. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

grant usage on schema public to anon, authenticated;

-- Read: everyone signed-in (and anon) may SELECT; RLS decides which rows.
grant select on all tables in schema public to anon, authenticated;

-- Write: only the player-owned tables (RLS + the lock/window triggers gate them).
grant insert, update, delete on
  public.profiles, public.match_picks, public.round_props, public.tourney_picks
  to authenticated;

-- Reference data: admins write via the admin RLS policies / SECURITY DEFINER RPCs,
-- so authenticated needs base DML here too (RLS still requires fb_is_admin()).
grant insert, update, delete on
  public.teams, public.rounds, public.matches, public.players_catalog, public.decay_schedule
  to authenticated;

-- Identity columns need sequence usage for inserts.
grant usage, select on all sequences in schema public to authenticated;

-- Keep future tables/sequences (later migrations) covered automatically.
alter default privileges in schema public grant select on tables to anon, authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
