-- ════════════════════════════════════════════════════════════════════════════
-- LOCAL DOCKER HARNESS ONLY — demo fixtures + chefs + picks so screens aren't
-- empty and the acceptance test has data. Inserts into the SHIM auth.users
-- (simple id/email table). NEVER mounted on a real Supabase stack, where GoTrue
-- owns auth.users and users sign up for real. Runs after 0001_init + seed.sql.
-- ════════════════════════════════════════════════════════════════════════════

-- Demo chefs (shim auth.users → profiles auto-created by trigger)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000a11c', 'alice@foodball.test'),
  ('00000000-0000-0000-0000-00000000b0b0', 'bob@foodball.test'),
  ('00000000-0000-0000-0000-00000000ca01', 'carol@foodball.test'),
  ('00000000-0000-0000-0000-00000000da0e', 'dave@foodball.test')
on conflict (id) do nothing;

update public.profiles set display_name = 'Alice', is_admin = true
  where id = '00000000-0000-0000-0000-00000000a11c';
update public.profiles set display_name = 'Bob'   where id = '00000000-0000-0000-0000-00000000b0b0';
update public.profiles set display_name = 'Carol' where id = '00000000-0000-0000-0000-00000000ca01';
update public.profiles set display_name = 'Dave'  where id = '00000000-0000-0000-0000-00000000da0e';

-- Matches: SEED-M1 finished upset, SEED-M2/M3 open (now()-relative kickoffs).
insert into public.matches
  (api_match_id, round_key, group_letter, home_team, away_team, kickoff,
   underdog_team, status, home_score, away_score, winner, result_source)
values
  ('SEED-M1', 'MD1', 'A',
   (select id from public.teams where fifa_code='ARG'),
   (select id from public.teams where fifa_code='MAR'),
   now() - interval '3 hours',
   (select id from public.teams where fifa_code='MAR'),
   'finished', 1, 2,
   (select id from public.teams where fifa_code='MAR'),
   'manual'),
  ('SEED-M2', 'MD1', 'D',
   (select id from public.teams where fifa_code='USA'),
   (select id from public.teams where fifa_code='GHA'),
   now() + interval '2 days',
   (select id from public.teams where fifa_code='GHA'),
   'scheduled', null, null, null, null),
  ('SEED-M3', 'MD1', 'C',
   (select id from public.teams where fifa_code='BRA'),
   (select id from public.teams where fifa_code='GER'),
   now() + interval '3 days',
   null, 'scheduled', null, null, null, null)
on conflict (api_match_id) do nothing;

-- Historical picks on the finished match. Bypass the lock trigger transiently
-- with session_replication_role (auto-resets on disconnect/rollback).
set session_replication_role = replica;
insert into public.match_picks (user_id, match_id, market, selection)
select u.uid, (select id from public.matches where api_match_id='SEED-M1'), 'outcome', u.sel
from (values
  ('00000000-0000-0000-0000-00000000a11c'::uuid, 'away'),  -- Alice: Morocco upset ✓ → 20
  ('00000000-0000-0000-0000-00000000b0b0'::uuid, 'home'),  -- Bob:   Argentina    ✗ → 0
  ('00000000-0000-0000-0000-00000000ca01'::uuid, 'away'),  -- Carol: Morocco upset ✓ → 20
  ('00000000-0000-0000-0000-00000000da0e'::uuid, 'home')   -- Dave:  Argentina    ✗ → 0
) as u(uid, sel)
on conflict (user_id, match_id, market) do nothing;
set session_replication_role = origin;

-- A live (open-match) pick so "My Picks" isn't empty.
insert into public.match_picks (user_id, match_id, market, selection)
values ('00000000-0000-0000-0000-00000000a11c',
        (select id from public.matches where api_match_id='SEED-M2'), 'outcome', 'home')
on conflict (user_id, match_id, market) do nothing;

-- Settle the finished match → score_events → leaderboard.
select public.fb_score_match((select id from public.matches where api_match_id='SEED-M1'));
