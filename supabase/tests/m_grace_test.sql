-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — launch-grace + pick-lock hardening acceptance test (0011/0013).
-- Runs against the live CLI stack (all migrations + real fixtures applied).
-- Transaction-wrapped + rolled back — creates a disposable match, toggles the
-- grace windows, and never persists anything.
--
--   psql -v ON_ERROR_STOP=1 -f m_grace_test.sql
--
-- Proves: (A) match-pick grace lets a normal user pick a post-kickoff, still-
-- playable match; (B) with grace OFF the same pick locks; (C/D) a FINISHED match
-- is never pickable — even with an anomalous future kickoff (audit bug #2);
-- (E) a client-supplied points_awarded is neutralized on INSERT (audit bug #1);
-- (F) a client cannot UPDATE points_awarded; (G) the three graces are independent.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

-- A real user + a disposable past-kickoff, still-playable match between two teams.
select id as uid from public.profiles limit 1
\gset
insert into public.matches (api_match_id, round_key, home_team, away_team, kickoff, status, result_source)
  select 'GRACE-TEST-M', 'MD1', t1.id, t2.id, now() - interval '1 hour', 'live', 'api'
  from (select id from public.teams order by id limit 1) t1,
       (select id from public.teams order by id offset 1 limit 1) t2
  returning id as mid
\gset
-- Expose the match id to PL/pgSQL DO blocks (which can't see psql :vars).
select set_config('app.mid', :'mid', true);

-- All three graces ON for the baseline.
update public.settings set
  match_picks_grace_until  = now() + interval '1 day',
  round_props_grace_until  = now() + interval '1 day',
  longshot_grace_until     = now() + interval '1 day'
where id;

-- Helper to act as the test user.
\set claim '{"role":"authenticated","sub":"' :uid '"}'

\echo '── A. grace ON: a normal user CAN pick a post-kickoff, still-playable match ─'
reset role;
select set_config('request.jwt.claims', :'claim', true);
set local role authenticated;
insert into public.match_picks (user_id, match_id, market, selection)
  values (auth.uid(), :mid, 'outcome', 'home');
\echo '   ✓ insert on a live (post-kickoff) match succeeded under grace'

\echo '── F. a client cannot UPDATE points_awarded (server-controlled) ───────────'
do $$
begin
  begin
    update public.match_picks set points_awarded = 9999
      where user_id = auth.uid() and match_id = current_setting('app.mid')::bigint and market = 'outcome';
    raise exception 'FAIL F: client UPDATE of points_awarded was allowed';
  exception when insufficient_privilege then null; -- expected
  end;
end $$;
\echo '   ✓ points_awarded UPDATE rejected (insufficient_privilege)'

\echo '── E. a client-supplied points_awarded is neutralized to NULL on INSERT ───'
insert into public.match_picks (user_id, match_id, market, selection, points_awarded)
  values (auth.uid(), :mid, 'btts', 'yes', 9999);
do $$
declare p int;
begin
  select points_awarded into p from public.match_picks
    where user_id = auth.uid() and match_id = current_setting('app.mid')::bigint and market = 'btts';
  assert p is null, format('FAIL E: forged points_awarded persisted (%s)', p);
end $$;
\echo '   ✓ forged points_awarded stored as NULL'

\echo '── B. grace OFF: the same kind of pick locks (kickoff passed) ──────────────'
reset role;
update public.settings set match_picks_grace_until = now() - interval '1 day' where id;
select set_config('request.jwt.claims', :'claim', true);
set local role authenticated;
do $$
begin
  begin
    insert into public.match_picks (user_id, match_id, market, selection)
      values (auth.uid(), current_setting('app.mid')::bigint, 'over_under', 'over');
    raise exception 'FAIL B: post-kickoff pick allowed with grace OFF';
  exception when check_violation then null; -- expected ("kickoff ... has passed")
  end;
end $$;
\echo '   ✓ post-kickoff pick rejected when grace is OFF'

reset role;
update public.settings set match_picks_grace_until = now() + interval '1 day' where id;  -- grace back ON

\echo '── C. a FINISHED match (past kickoff) is never pickable, even under grace ──'
update public.matches set status = 'finished' where id = :mid;
select set_config('request.jwt.claims', :'claim', true);
set local role authenticated;
do $$
begin
  begin
    insert into public.match_picks (user_id, match_id, market, selection)
      values (auth.uid(), current_setting('app.mid')::bigint, 'exact_score', '1-0');
    raise exception 'FAIL C: pick on a finished match was allowed';
  exception when check_violation then null; -- expected ("it has finished")
  end;
end $$;
\echo '   ✓ finished match rejects new picks under active grace'

\echo '── D. FINISHED + FUTURE kickoff still rejects (audit bug #2 regression) ────'
reset role;
update public.matches set status = 'finished', kickoff = now() + interval '1 day' where id = :mid;
select set_config('request.jwt.claims', :'claim', true);
set local role authenticated;
do $$
begin
  begin
    insert into public.match_picks (user_id, match_id, market, selection)
      values (auth.uid(), current_setting('app.mid')::bigint, 'exact_score', '2-0');
    raise exception 'FAIL D: pick on a finished+future-kickoff match was allowed';
  exception when check_violation then null; -- expected ("it has finished")
  end;
end $$;
\echo '   ✓ finished-with-future-kickoff still rejected'

\echo '── G. the three grace windows are independent ─────────────────────────────'
reset role;
update public.settings set match_picks_grace_until = now() - interval '1 day' where id;  -- only match grace off
do $$
declare m boolean; r boolean; l boolean;
begin
  m := public.fb_match_picks_grace_active();
  r := public.fb_round_props_grace_active();
  l := public.fb_longshot_grace_active();
  assert m = false, 'G: match grace should be inactive';
  assert r = true,  'G: round-props grace must stay active';
  assert l = true,  'G: long-shot grace must stay active';
end $$;
\echo '   ✓ toggling match grace left round-props + long-shot grace untouched'

rollback;
\echo '════ m_grace_test: ALL PASS ════'
