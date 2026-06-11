-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall REFERENCE seed — safe on ANY environment (local harness, Supabase CLI
-- `db reset`, hosted). Static reference data only: teams, rounds, decay schedule.
-- Demo users/matches/picks live in docker/db-init/03_demo.sql (local harness only,
-- where auth.users is the simple shim — GoTrue owns auth.users on a real stack).
-- ════════════════════════════════════════════════════════════════════════════

-- ── Teams (FIFA rank drives the default underdog) ───────────────────────────
insert into public.teams (name, fifa_code, fifa_rank, group_letter, flag_emoji) values
  ('Argentina', 'ARG',  1, 'A', '🇦🇷'),
  ('France',    'FRA',  2, 'B', '🇫🇷'),
  ('Brazil',    'BRA',  3, 'C', '🇧🇷'),
  ('USA',       'USA', 11, 'D', '🇺🇸'),
  ('Mexico',    'MEX', 12, 'E', '🇲🇽'),
  ('Canada',    'CAN', 30, 'F', '🇨🇦'),
  ('Morocco',   'MAR', 13, 'A', '🇲🇦'),
  ('Japan',     'JPN', 18, 'B', '🇯🇵'),
  ('Germany',   'GER',  9, 'C', '🇩🇪'),
  ('Ghana',     'GHA', 60, 'D', '🇬🇭')
on conflict (fifa_code) do nothing;

-- ── Rounds (keys fixed; windows per spec §3) ────────────────────────────────
insert into public.rounds (key, name, first_kickoff, sort_order) values
  ('MD1', 'Group Matchday 1', '2026-06-11 16:00:00+00', 1),
  ('MD2', 'Group Matchday 2', '2026-06-18 16:00:00+00', 2),
  ('MD3', 'Group Matchday 3', '2026-06-24 16:00:00+00', 3),
  ('R32', 'Round of 32',      '2026-06-28 16:00:00+00', 4),
  ('R16', 'Round of 16',      '2026-07-04 16:00:00+00', 5),
  ('QF',  'Quarter-finals',   '2026-07-09 16:00:00+00', 6),
  ('SF',  'Semi-finals',      '2026-07-14 16:00:00+00', 7),
  ('F',   'Third place + Final','2026-07-18 16:00:00+00', 8)
on conflict (key) do nothing;

-- ── Decay schedule (spec §4.3) — seeded now; scored from M2 onward ──────────
insert into public.decay_schedule (pick_type, set_after_round, points) values
  ('champion', null,100),('champion','MD3',70),('champion','R32',50),
  ('champion','R16',35),('champion','QF',20),('champion','SF',10),
  ('finalist', null,40),('finalist','MD3',30),('finalist','R32',20),
  ('finalist','R16',15),('finalist','QF',8),
  ('golden_boot',null,50),('golden_boot','MD3',35),('golden_boot','R32',25),
  ('golden_boot','R16',18),('golden_boot','QF',10),('golden_boot','SF',5),
  ('golden_glove',null,40),('golden_glove','MD3',28),('golden_glove','R32',20),
  ('golden_glove','R16',14),('golden_glove','QF',8),('golden_glove','SF',4),
  ('young_player',null,30),('young_player','MD3',20),('young_player','R32',15),
  ('young_player','R16',10),('young_player','QF',6),('young_player','SF',3),
  ('total_goals',null,30),('total_goals','MD3',20)
on conflict (pick_type, set_after_round) do nothing;
