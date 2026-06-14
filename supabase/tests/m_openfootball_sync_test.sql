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
--
-- Self-contained: it picks a STILL-SCHEDULED future group match (so it is
-- robust as real fixtures finish over the tournament) and builds the openfootball
-- payload from that match's own team names — no hardcoded fixture.
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

select id as uid from public.profiles limit 1
\gset
-- The next still-scheduled group match (pickable + not yet settled).
select id as mid from public.matches
  where status = 'scheduled' and kickoff > now() and group_letter is not null
  order by kickoff limit 1
\gset
select set_config('app.uid', :'uid', true);
select set_config('app.mid', :'mid', true);

-- Place a correct outcome pick (home win). Match is scheduled/future → pickable.
insert into public.match_picks (user_id, match_id, market, selection)
  values (:'uid', :mid, 'outcome', 'home')
  on conflict (user_id, match_id, market) do update set selection = 'home';

\echo '── A. openfootball publishes a 2–1 home win → self-settles + scores ────────'
-- Payload built from the match''s OWN teams/group, so the name match always hits.
select public.fb_settle_from_openfootball_json(
  jsonb_build_object('matches', jsonb_build_array(
    jsonb_build_object('group', 'Group ' || m.group_letter,
                       'team1', h.name, 'team2', a.name,
                       'score1', 2, 'score2', 1)))
) as settled
from public.matches m
join public.teams h on h.id = m.home_team
join public.teams a on a.id = m.away_team
where m.id = :mid;

do $$
declare st text; hs int; a_ int; src text; pts int;
begin
  select status, home_score, away_score, result_source into st, hs, a_, src
    from public.matches where id = current_setting('app.mid')::bigint;
  assert st = 'finished', format('A: status %s', st);
  assert hs = 2 and a_ = 1, format('A: score %s-%s', hs, a_);
  assert src = 'api', format('A: result_source %s', src);
  select points_awarded into pts from public.match_picks
    where user_id = current_setting('app.uid')::uuid
      and match_id = current_setting('app.mid')::bigint and market = 'outcome';
  assert pts is not null and pts > 0, format('A: picker not scored (%s)', pts);
end $$;
\echo '   ✓ settled 2–1, result_source=api, no admin action, correct picker scored'

\echo '── B. a MANUAL result is never overwritten by openfootball ────────────────'
update public.matches set status = 'finished', home_score = 0, away_score = 0, result_source = 'manual'
  where id = :mid;
select public.fb_settle_from_openfootball_json(
  jsonb_build_object('matches', jsonb_build_array(
    jsonb_build_object('group', 'Group ' || m.group_letter,
                       'team1', h.name, 'team2', a.name,
                       'score1', 5, 'score2', 5)))
) as attempted
from public.matches m
join public.teams h on h.id = m.home_team
join public.teams a on a.id = m.away_team
where m.id = :mid;

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
