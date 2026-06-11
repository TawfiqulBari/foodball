-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall M1 server-side acceptance test (spec §9 M1 checklist).
-- Runs against the Dockerized Postgres with migration + seed applied. Wrapped in
-- a transaction and rolled back, so it is repeatable and never mutates the seed.
--
--   psql -v ON_ERROR_STOP=1 -f core_loop_test.sql
--
-- Simulates signed-in users exactly as PostgREST does: SET ROLE authenticated +
-- the request JWT 'sub' claim, so auth.uid() and every RLS policy are live.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

\echo '── 1. Two users pick differently on an OPEN match (allowed) ───────────────'
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
insert into public.match_picks (user_id, match_id, market, selection)
  values (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'outcome', 'home');

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000ca01', true);  -- Carol
set local role authenticated;
insert into public.match_picks (user_id, match_id, market, selection)
  values (auth.uid(), (select id from public.matches where api_match_id='SEED-M2'), 'outcome', 'away');
\echo '   ✓ both picks inserted'

\echo '── 2. Pre-lock anti-copying: a user sees only their OWN pick on an open match'
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
do $$
begin
  assert (select count(*) from public.match_picks mp
          join public.matches m on m.id = mp.match_id
          where m.api_match_id = 'SEED-M2') = 1,
    'VISIBILITY FAIL: pre-lock, Bob must see only his own pick on the open match';
end $$;
\echo '   ✓ others'' picks hidden before kickoff'

\echo '── 3. ★ Server rejects a pick after kickoff (THE M1 crux) ★ ──────────────'
-- Bob attempts a NEW market on the already-finished SEED-M1 (kickoff 3h ago).
-- Using a market with no existing row isolates the LOCK trigger from the unique
-- constraint, and we assert on the lock''s own error message.
do $$
declare blocked boolean := false;
begin
  begin
    insert into public.match_picks (user_id, match_id, market, selection)
      values (auth.uid(), (select id from public.matches where api_match_id='SEED-M1'), 'btts', 'yes');
  exception when others then
    blocked := (SQLERRM like 'FoodBall: picks for match%locked%');
  end;
  assert blocked, 'LOCK FAIL: server accepted a pick after kickoff (or failed for the wrong reason)';
end $$;
\echo '   ✓ post-kickoff pick rejected by the lock trigger'

\echo '── 4. Admin guard: a non-admin cannot settle a result ────────────────────'
do $$
declare blocked boolean := false;
begin
  begin
    perform public.fb_admin_set_result(
      (select id from public.matches where api_match_id='SEED-M2'), 1, 0);
  exception when others then
    blocked := (SQLERRM like '%admin only%');
  end;
  assert blocked, 'ADMIN GUARD FAIL: a non-admin was allowed to set a result';
end $$;
\echo '   ✓ non-admin blocked from fb_admin_set_result'

\echo '── 5. Admin settles a result → scoring → leaderboard updates ─────────────'
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11c', true);  -- Alice (admin)
set local role authenticated;
-- USA (home, favorite) beat Ghana 2-0. Home pickers get 10 (no upset).
select public.fb_admin_set_result(
  (select id from public.matches where api_match_id='SEED-M2'), 2, 0);

\echo '── 6. Verify the full standings (incl. upset ×2 from the seed) ───────────'
reset role;
do $$
declare a int; b int; c int; d int;
begin
  select total into a from public.leaderboard where display_name = 'Alice';
  select total into b from public.leaderboard where display_name = 'Bob';
  select total into c from public.leaderboard where display_name = 'Carol';
  select total into d from public.leaderboard where display_name = 'Dave';
  -- Alice: M1 Morocco upset ✓ (10×2) + M2 USA ✓ (10) = 30
  -- Bob:   M1 Argentina ✗ (0)     + M2 USA ✓ (10) = 10
  -- Carol: M1 Morocco upset ✓ (20)+ M2 Ghana ✗ (0) = 20
  -- Dave:  M1 Argentina ✗ (0)                      = 0
  assert a = 30, format('SCORE FAIL: Alice expected 30, got %s', a);
  assert b = 10, format('SCORE FAIL: Bob expected 10, got %s', b);
  assert c = 20, format('SCORE FAIL: Carol expected 20, got %s', c);
  assert d = 0,  format('SCORE FAIL: Dave expected 0, got %s', d);
end $$;
\echo '   ✓ outcome scoring + upset ×2 + leaderboard totals correct'

\echo '── 7. Re-scoring is idempotent (admin re-enters same result) ─────────────'
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000a11c', true);
set local role authenticated;
select public.fb_admin_set_result(
  (select id from public.matches where api_match_id='SEED-M1'), 1, 2, null, null,
  (select id from public.teams where fifa_code='MAR'));
reset role;
do $$
declare evts int; alice_total int;
begin
  select count(*) into evts from public.score_events se
    join public.match_picks mp on mp.id = se.source_id and se.source_table='match_picks'
    join public.matches m on m.id = mp.match_id
    where m.api_match_id = 'SEED-M1'
      and se.user_id = '00000000-0000-0000-0000-00000000a11c';
  assert evts = 1, format('IDEMPOTENCY FAIL: Alice has %s score_events for M1 (expected 1)', evts);
  select total into alice_total from public.leaderboard where display_name = 'Alice';
  assert alice_total = 30, format('IDEMPOTENCY FAIL: Alice total drifted to %s after re-score', alice_total);
end $$;
\echo '   ✓ re-scoring updates in place, no duplicate score_events'

\echo '── 8. Scoring column & match-id are server-controlled (not client-writable) ─'
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000b0b0', true);  -- Bob
set local role authenticated;
do $$
declare blocked boolean := false;
begin
  begin
    update public.match_picks set points_awarded = 999
     where user_id = auth.uid()
       and match_id = (select id from public.matches where api_match_id='SEED-M2')
       and market = 'outcome';
  exception when others then blocked := (SQLERRM like '%server-controlled%');
  end;
  assert blocked, 'GUARD FAIL: a user was allowed to write their own points_awarded';
end $$;
do $$
declare blocked boolean := false;
begin
  begin
    update public.match_picks set match_id = (select id from public.matches where api_match_id='SEED-M3')
     where user_id = auth.uid()
       and match_id = (select id from public.matches where api_match_id='SEED-M2')
       and market = 'outcome';
  exception when others then blocked := (SQLERRM like '%cannot be moved%');
  end;
  assert blocked, 'GUARD FAIL: a user was allowed to move a pick to another match';
end $$;
reset role;
\echo '   ✓ points_awarded and match_id rejected for the authenticated role'

rollback;
\echo ''
\echo '════════════════════════════════════════════════════════════════════════'
\echo '  ✅ ALL M1 SERVER-SIDE ACCEPTANCE CHECKS PASSED'
\echo '════════════════════════════════════════════════════════════════════════'
