-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — one-time void of post-kickoff picks (2026-06-14).
--
-- Voids the 23 participant match-picks that were first SET after their match
-- kicked off (the `0011` grace window let them through; `0016` now prevents it).
-- Chef tawfiq's 4 post-kickoff picks (ids 69,71,79,227) are EXCLUDED — that is
-- the admin's own test data, not a competitor.
--
-- For each voided pick this: (1) records a row in `red_cards`, (2) deletes the
-- pick's `score_events` (the leaderboard view then recomputes), (3) deletes the
-- pick. Run as a superuser; transaction-wrapped. A reversible backup of the
-- exact rows lives in docs/voided-picks-backup-2026-06-14.sql.
--
--   docker exec -i supabase_db_foodball psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < scripts/void-post-kickoff-picks.sql
-- ════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;

-- The exact picks to void (participants only; admin/Chef tawfiq excluded).
create temporary table _void_ids (id bigint primary key) on commit drop;
insert into _void_ids (id) values
  (87),(88),(92),(232),       -- Emon
  (237),(238),                -- Fahad
  (788),(808),(809),          -- kaife.adon
  (785),(790),                -- Md Rubel
  (129),(770),                -- nayem
  (184),(224),(225),(797),(798), -- pavel
  (805),                      -- shahriar
  (118),(127),(376),(377);    -- ST23

-- Bypass the finished-match pick-lock trigger for this admin cleanup only.
set local session_replication_role = replica;

-- 1. Record the red cards (denormalized, display-ready).
insert into public.red_cards
  (user_id, match_id, match_label, market, selection, points_deducted,
   kickoff, picked_at, minutes_after_kickoff, reason)
select p.user_id, p.match_id,
       coalesce(ht.fifa_code,'?') || ' v ' || coalesce(at.fifa_code,'?'),
       p.market, p.selection,
       coalesce(se.points, 0),
       m.kickoff, p.created_at,
       round(extract(epoch from (p.created_at - m.kickoff)) / 60)::int,
       'Prediction set after kickoff (grace window) — voided'
from public.match_picks p
join public.matches m   on m.id = p.match_id
left join public.teams ht on ht.id = m.home_team
left join public.teams at on at.id = m.away_team
left join public.score_events se on se.source_table = 'match_picks' and se.source_id = p.id
where p.id in (select id from _void_ids);

-- 2. Remove the score_events those picks earned (recompute via the view).
delete from public.score_events se
where se.source_table = 'match_picks' and se.source_id in (select id from _void_ids);

-- 3. Remove the voided picks themselves.
delete from public.match_picks where id in (select id from _void_ids);

-- Sanity: 23 cards in, 23 picks gone.
do $$
declare n_cards int; n_left int;
begin
  select count(*) into n_cards from public.red_cards;
  select count(*) into n_left from public.match_picks
    where id in (87,88,92,232,237,238,788,808,809,785,790,129,770,184,224,225,797,798,805,118,127,376,377);
  raise notice 'red_cards rows now=%, voided picks still present=% (expect 23, 0)', n_cards, n_left;
  assert n_left = 0, 'void incomplete: some target picks remain';
end $$;

commit;
