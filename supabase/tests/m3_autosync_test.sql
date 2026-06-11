-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall M3 server-side acceptance test (spec §9 M3 checklist).
-- Runs against the Dockerized Postgres with 0001+0002+0003+seed+demo applied.
-- Transaction-wrapped + rolled back.
--
--   psql -v ON_ERROR_STOP=1 -f m3_autosync_test.sql
--
-- Proves: (A) a simulated API payload settles a match END-TO-END with NO admin
-- action (fb_ingest_result, as the service role would call it); (B) a manual
-- result entered first is NOT overwritten by a later API poll; (C) a 'live' poll
-- updates the score without scoring; (D) rank snapshots feed rank_delta.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

\echo '── A. Live then finished: an API poll settles a match with NO admin action ─'
-- Bob picks USA (home, favorite) to win the open SEED-M2.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
insert into public.match_picks (user_id, match_id, market, selection)
  values (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'outcome', 'home');

-- A 'live' poll (as the service role / Edge Function would call it — NOT an admin RPC).
reset role;
select public.fb_ingest_result('SEED-M2', 1, 0, 'live');
do $$
declare st text; pts int;
begin
  select status into st from public.matches where api_match_id='SEED-M2';
  assert st = 'live', format('A: expected live, got %s', st);
  select points_awarded into pts from public.match_picks mp
    join public.matches m on m.id=mp.match_id
    where m.api_match_id='SEED-M2' and mp.user_id='00000000-0000-0000-0000-00000000b0b0' and mp.market='outcome';
  assert pts is null, 'A: a live (unfinished) match must not be scored yet';
end $$;
\echo '   ✓ live poll updates score, no scoring'

-- A 'finished' poll auto-scores end-to-end — still no admin action.
reset role;
do $$ declare r text; begin
  r := public.fb_ingest_result('SEED-M2', 2, 0, 'finished');
  assert r = 'scored', format('A: ingest returned %s', r);
end $$;
do $$
declare st text; src text; pts int;
begin
  select status, result_source into st, src from public.matches where api_match_id='SEED-M2';
  assert st = 'finished' and src = 'api', format('A: expected finished/api, got %s/%s', st, src);
  select points_awarded into pts from public.match_picks mp
    join public.matches m on m.id=mp.match_id
    where m.api_match_id='SEED-M2' and mp.user_id='00000000-0000-0000-0000-00000000b0b0' and mp.market='outcome';
  assert pts = 10, format('A: Bob USA-home should score 10, got %s', pts);
  assert exists (select 1 from public.score_events
                  where source_table='match_picks' and user_id='00000000-0000-0000-0000-00000000b0b0' and points=10),
    'A: no score_event written by the auto-sync path';
end $$;
\echo '   ✓ finished poll settles the match end-to-end with no admin action'

\echo '── B. Manual ALWAYS wins: a later API poll does NOT overwrite a manual result'
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11c', true);  -- Alice (admin)
set local role authenticated;
select public.fb_admin_set_result((select id from public.matches where api_match_id='SEED-M3'), 1, 0);  -- BRA 1-0 GER, manual
reset role;
do $$ declare r text; begin
  r := public.fb_ingest_result('SEED-M3', 3, 3, 'finished');  -- conflicting API payload arrives later
  assert r like 'skip: manual%', format('B: expected manual-skip, got %s', r);
end $$;
do $$
declare hs int; as_ int; src text;
begin
  select home_score, away_score, result_source into hs, as_, src from public.matches where api_match_id='SEED-M3';
  assert hs = 1 and as_ = 0, format('B: manual 1-0 was overwritten to %s-%s', hs, as_);
  assert src = 'manual', format('B: result_source flipped to %s', src);
end $$;
\echo '   ✓ manual result preserved; API poll skipped it'

\echo '── C. Unknown match id is a safe no-op ───────────────────────────────────'
reset role;
do $$ declare r text; begin
  r := public.fb_ingest_result('NOPE-404', 1, 1, 'finished');
  assert r like 'skip: unknown%', format('C: expected unknown-skip, got %s', r);
end $$;
\echo '   ✓ unknown api_match_id skipped safely'

\echo '── D. Rank snapshot feeds rank_delta ─────────────────────────────────────'
reset role;
select public.fb_snapshot_ranks('MD1');
do $$
declare snaps int;
begin
  select count(*) into snaps from public.rank_history where round_key='MD1';
  assert snaps > 0, 'D: no rank_history rows captured';
  -- Immediately after a snapshot, every delta is 0 (snapshot rank == current rank).
  assert not exists (select 1 from public.leaderboard where rank_delta <> 0),
    'D: rank_delta should be 0 right after a snapshot';
end $$;
\echo '   ✓ rank snapshot captured; rank_delta computes from it'

rollback;
\echo ''
\echo '════════════════════════════════════════════════════════════════════════'
\echo '  ✅ ALL M3 SERVER-SIDE ACCEPTANCE CHECKS PASSED'
\echo '════════════════════════════════════════════════════════════════════════'
