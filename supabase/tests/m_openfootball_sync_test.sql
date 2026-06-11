-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — openfootball token-free auto-settle acceptance test (0014).
-- Runs against the live CLI stack. Transaction-wrapped + rolled back.
--
--   psql -v ON_ERROR_STOP=1 -f m_openfootball_sync_test.sql
--
-- Proves: (A) a published final score in an openfootball payload settles the
-- matching group match END-TO-END with no admin action (status finished, score
-- stored, result_source='api', and a correct picker is scored); (B) a MANUAL
-- result is never overwritten by openfootball (manual always wins).
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

-- A real user + the real Group A opener (Mexico v South Africa).
select id as uid from public.profiles limit 1
\gset
select id as mid, api_match_id as api from public.matches
  where home_team = (select id from public.teams where name = 'Mexico')
    and away_team = (select id from public.teams where name = 'South Africa')
\gset
select set_config('app.uid', :'uid', true);
select set_config('app.mid', :'mid', true);
select set_config('app.api', :'api', true);

-- Make it pickable (grace ON) and place a correct outcome pick (MEX to win).
update public.settings set match_picks_grace_until = now() + interval '1 day' where id;
insert into public.match_picks (user_id, match_id, market, selection)
  values (:'uid', :mid, 'outcome', 'home')
  on conflict (user_id, match_id, market) do update set selection = 'home';

\echo '── A. openfootball publishes MEX 2–1 RSA → self-settles + scores ──────────'
select public.fb_settle_from_openfootball_json(
  '{"matches":[{"group":"Group A","team1":"Mexico","team2":"South Africa","score1":2,"score2":1}]}'::jsonb
) as settled;
do $$
declare st text; hs int; a_ int; src text; pts int;
begin
  select status, home_score, away_score, result_source into st, hs, a_, src
    from public.matches where api_match_id = current_setting('app.api');
  assert st = 'finished', format('A: status %s', st);
  assert hs = 2 and a_ = 1, format('A: score %s-%s', hs, a_);
  assert src = 'api', format('A: result_source %s', src);
  select points_awarded into pts from public.match_picks
    where user_id = current_setting('app.uid')::uuid and match_id = current_setting('app.mid')::bigint and market = 'outcome';
  assert pts is not null and pts > 0, format('A: picker not scored (%s)', pts);
end $$;
\echo '   ✓ settled 2–1, result_source=api, no admin action, correct picker scored'

\echo '── B. a MANUAL result is never overwritten by openfootball ────────────────'
update public.matches set status = 'finished', home_score = 0, away_score = 0, result_source = 'manual'
  where id = :mid;
select public.fb_settle_from_openfootball_json(
  '{"matches":[{"group":"Group A","team1":"Mexico","team2":"South Africa","score1":5,"score2":5}]}'::jsonb
) as attempted;
do $$
declare hs int; a_ int; src text;
begin
  select home_score, away_score, result_source into hs, a_, src
    from public.matches where id = current_setting('app.mid')::bigint;
  assert hs = 0 and a_ = 0 and src = 'manual', format('B: manual overwritten → %s-%s/%s', hs, a_, src);
end $$;
\echo '   ✓ manual result preserved (openfootball skipped)'

rollback;
\echo '════ m_openfootball_sync_test: ALL PASS ════'
