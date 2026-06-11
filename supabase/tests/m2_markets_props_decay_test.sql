-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall M2 server-side acceptance test (spec §9 M2 checklist).
-- Runs against the Dockerized Postgres with 0001 + 0002 + seed + demo applied.
-- Wrapped in a transaction and rolled back, so it is repeatable and never mutates
-- the seed.
--
--   psql -v ON_ERROR_STOP=1 -f m2_markets_props_decay_test.sql
--
-- Proves: (A) all per-match markets score (exact +25 / btts 5 / over_under 5);
-- (B) round props settle (Top Chef / Clean Plate / Spice) and lock at round
-- start; (C) decay matches §4.3, the server STAMPS the decay bucket (a forged
-- bucket is overwritten), a revision while a round is in progress is REJECTED
-- server-side, and tournament settlement pays the decayed value. Round state is
-- set explicitly so the result never depends on the wall-clock time of day.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

-- ── Setup: a USA goalkeeper + a striker in the catalog (owner bypasses RLS) ───
reset role;
insert into public.players_catalog (api_player_id, name, team, position) values
  ('TEST-GK', 'Tim US',      (select id from public.teams where fifa_code='USA'), 'GK'),
  ('TEST-FW', 'Sam Striker', (select id from public.teams where fifa_code='BRA'), 'FW')
on conflict (api_player_id) do nothing;

\echo '── A. Per-match markets: exact (+25), BTTS (5), over/under (5) ────────────'
-- Bob & Carol pick all four markets on the OPEN SEED-M2 (USA vs GHA), then admin
-- settles USA 2-0 GHA. Bob nails every market; Carol misses every one.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
insert into public.match_picks (user_id, match_id, market, selection) values
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'outcome',     'home'),
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'exact_score', '2-0'),
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'btts',        'no'),
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'over_under',  'under');

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ca01', true);  -- Carol
set local role authenticated;
insert into public.match_picks (user_id, match_id, market, selection) values
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'outcome',     'away'),
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'exact_score', '1-1'),
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'btts',        'yes'),
  (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'over_under',  'over');

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11c', true);  -- Alice (admin)
set local role authenticated;
select public.fb_admin_set_result(
  (select id from public.matches where api_match_id='SEED-M2'), 2, 0);

reset role;
do $$
declare m bigint := (select id from public.matches where api_match_id='SEED-M2');
  bob uuid := '00000000-0000-0000-0000-00000000b0b0';
  carol uuid := '00000000-0000-0000-0000-00000000ca01';
begin
  assert (select points_awarded from public.match_picks where user_id=bob and match_id=m and market='outcome')     = 10, 'A: Bob outcome ≠ 10';
  assert (select points_awarded from public.match_picks where user_id=bob and match_id=m and market='exact_score') = 25, 'A: Bob exact ≠ 25';
  assert (select points_awarded from public.match_picks where user_id=bob and match_id=m and market='btts')        = 5,  'A: Bob btts ≠ 5';
  assert (select points_awarded from public.match_picks where user_id=bob and match_id=m and market='over_under')  = 5,  'A: Bob over_under ≠ 5';
  assert (select points_awarded from public.match_picks where user_id=carol and match_id=m and market='exact_score') = 0, 'A: Carol exact ≠ 0';
  assert (select points_awarded from public.match_picks where user_id=carol and match_id=m and market='btts')        = 0, 'A: Carol btts ≠ 0';
  assert (select points_awarded from public.match_picks where user_id=carol and match_id=m and market='over_under')  = 0, 'A: Carol over_under ≠ 0';
  -- leaderboard exact_hits counts only SCORED exact picks (points > 0)
  assert (select exact_hits from public.leaderboard where user_id=bob)   = 1, 'A: Bob exact_hits ≠ 1';
  assert (select exact_hits from public.leaderboard where user_id=carol) = 0, 'A: Carol exact_hits ≠ 0';
end $$;
\echo '   ✓ exact/BTTS/over-under scored; exact_hits counts only scored exacts'

\echo '── B. Round props: Spice (20), Clean Plate (10), Top Chef (15) + lock ─────'
-- Open MD1 for prop entry, then place props as their owners.
reset role;
update public.rounds set first_kickoff = now() + interval '2 days', completed = false where key='MD1';

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
insert into public.round_props (user_id, round_key, prop, selection) values
  (auth.uid(), 'MD1', 'spice',       (select id::text from public.matches where api_match_id='SEED-M1')),  -- MAR upset won → 20
  (auth.uid(), 'MD1', 'clean_plate', (select id::text from public.players_catalog where api_player_id='TEST-GK')),  -- USA clean sheet in M2 → 10
  (auth.uid(), 'MD1', 'top_chef',    (select id::text from public.players_catalog where api_player_id='TEST-FW')); -- admin names as scorer → 15

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ca01', true);  -- Carol
set local role authenticated;
insert into public.round_props (user_id, round_key, prop, selection) values
  (auth.uid(), 'MD1', 'spice', (select id::text from public.matches where api_match_id='SEED-M2'));  -- USA (favorite) won → 0

-- Lock: once MD1 has started, a NEW prop pick is rejected server-side.
reset role;
update public.rounds set first_kickoff = now() - interval '1 hour' where key='MD1';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000da0e', true);  -- Dave
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    insert into public.round_props (user_id, round_key, prop, selection)
    values (auth.uid(), 'MD1', 'spice', (select id::text from public.matches where api_match_id='SEED-M3'));
  exception when others then blocked := (SQLERRM like '%locked%');
  end;
  assert blocked, 'B: a round-prop pick after the round started was NOT rejected';
end $$;
\echo '   ✓ post-start round-prop pick rejected by the lock trigger'

-- Admin names the round top scorer and settles MD1 props.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11c', true);  -- Alice
set local role authenticated;
select public.fb_admin_settle_round('MD1',
  array[(select id from public.players_catalog where api_player_id='TEST-FW')], false);

reset role;
do $$
declare bob uuid := '00000000-0000-0000-0000-00000000b0b0';
  carol uuid := '00000000-0000-0000-0000-00000000ca01';
begin
  assert (select points_awarded from public.round_props where user_id=bob and prop='spice')       = 20, 'B: Bob spice ≠ 20';
  assert (select points_awarded from public.round_props where user_id=bob and prop='clean_plate') = 10, 'B: Bob clean_plate ≠ 10';
  assert (select points_awarded from public.round_props where user_id=bob and prop='top_chef')    = 15, 'B: Bob top_chef ≠ 15';
  assert (select points_awarded from public.round_props where user_id=carol and prop='spice')      = 0,  'B: Carol spice ≠ 0';
end $$;
\echo '   ✓ Spice / Clean Plate / Top Chef settled correctly'

\echo '── C. Tournament decay + the M2 crux: server-stamped bucket + window lock ─'
-- C0: the Postgres decay fn mirrors spec §4.3 (mirrors src/lib/decay.ts).
reset role;
do $$
begin
  assert public.fb_decay_points('champion', null)   = 100, 'C0: champion/Before MD1 ≠ 100';
  assert public.fb_decay_points('champion', 'MD1')  = 70,  'C0: champion/MD1 ≠ 70 (group bucket)';
  assert public.fb_decay_points('champion', 'MD3')  = 70,  'C0: champion/MD3 ≠ 70';
  assert public.fb_decay_points('champion', 'R32')  = 50,  'C0: champion/R32 ≠ 50';
  assert public.fb_decay_points('finalist', 'SF')   = 0,   'C0: finalist/SF must be 0 (—)';
  assert public.fb_decay_points('total_goals','R32')= 0,   'C0: total_goals/R32 must be 0 (—)';
  assert public.fb_decay_points('golden_glove','QF')= 8,   'C0: golden_glove/QF ≠ 8';
end $$;
\echo '   ✓ fb_decay_points matches spec §4.3'

-- C1: pre-tournament (nothing completed) ⇒ window open; pick stamped bucket null.
reset role;
update public.rounds set first_kickoff = now() + interval '10 days', completed = false;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
select public.fb_set_tourney_pick('champion', (select id::text from public.teams where fifa_code='ARG'));
reset role;
do $$
declare bob uuid := '00000000-0000-0000-0000-00000000b0b0';
begin
  assert (select set_after_round from public.tourney_picks
            where user_id=bob and pick_type='champion'
            order by created_at desc, id desc limit 1) is null,
    'C1: a pre-tournament champion pick must be stamped set_after_round = null';
end $$;
\echo '   ✓ pre-tournament pick stamped bucket null (worth 100)'

-- C2: group + R32 complete, knockouts not started ⇒ window open, latest = R32.
-- A client FORGES set_after_round=null (to grab 100); the trigger overwrites it
-- with the true bucket 'R32'.
reset role;
update public.rounds set first_kickoff = now() + interval '10 days', completed = false;
update public.rounds set first_kickoff = now() - interval '5 days', completed = true
  where key in ('MD1','MD2','MD3','R32');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
insert into public.tourney_picks (user_id, pick_type, selection, set_after_round)
  values (auth.uid(), 'champion', (select id::text from public.teams where fifa_code='ARG'), null);  -- forged null
reset role;
do $$
declare bob uuid := '00000000-0000-0000-0000-00000000b0b0';
begin
  assert (select set_after_round from public.tourney_picks
            where user_id=bob and pick_type='champion'
            order by created_at desc, id desc limit 1) = 'R32',
    'C2: forged set_after_round was NOT overwritten with the true bucket R32';
end $$;
\echo '   ✓ a forged decay bucket is overwritten server-side (R32, worth 50)'

-- C3 ★ THE M2 CRUX ★: a round in progress ⇒ window closed ⇒ revision rejected,
-- via the RPC AND via a forged direct REST-style insert.
reset role;
update public.rounds set completed = false, first_kickoff = now() - interval '1 hour' where key='R16';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    perform public.fb_set_tourney_pick('champion', (select id::text from public.teams where fifa_code='BRA'));
  exception when others then blocked := (SQLERRM like '%revision window is closed%');
  end;
  assert blocked, 'C3: RPC revision during an in-progress round was NOT rejected';
end $$;
do $$
declare blocked boolean := false;
begin
  begin
    insert into public.tourney_picks (user_id, pick_type, selection)
      values (auth.uid(), 'champion', (select id::text from public.teams where fifa_code='BRA'));
  exception when others then blocked := (SQLERRM like '%revision window is closed%');
  end;
  assert blocked, 'C3: forged direct insert during an in-progress round was NOT rejected';
end $$;
\echo '   ✓ revision outside an open window rejected server-side (RPC + raw insert)'

-- C4: settlement pays the decayed value of the ACTIVE pick (latest = R32 ⇒ 50),
-- not the pre-tournament 100, proving decay + "latest active" both apply.
reset role;
update public.rounds set completed = true, first_kickoff = now() - interval '5 days' where key='R16';
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11c', true);  -- Alice
set local role authenticated;
select public.fb_admin_set_tournament_result('champion', (select id::text from public.teams where fifa_code='ARG'));
reset role;
do $$
declare bob uuid := '00000000-0000-0000-0000-00000000b0b0'; v_pts int;
begin
  select points_awarded into v_pts from public.tourney_picks
    where user_id=bob and pick_type='champion'
    order by created_at desc, id desc limit 1;
  assert v_pts = 50, format('C4: active champion pick paid %s, expected 50 (R32 decay)', v_pts);
  assert (select points from public.score_events
            where source_table='tourney_picks' and reason='tourney:champion'
              and user_id=bob order by created_at desc limit 1) = 50,
    'C4: tournament score_event ≠ 50';
end $$;
\echo '   ✓ champion settled at the decayed value (50), via the active R32 pick'

rollback;
\echo ''
\echo '════════════════════════════════════════════════════════════════════════'
\echo '  ✅ ALL M2 SERVER-SIDE ACCEPTANCE CHECKS PASSED'
\echo '════════════════════════════════════════════════════════════════════════'
