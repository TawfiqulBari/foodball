-- FoodBall — final settlement of World Cup 2026 (run once, 2026-07-19).
--
-- openfootball never published the Final, so it is entered manually here (manual entry
-- is authoritative and is never overwritten by the auto-settler). Tournament long-shots
-- are admin-entered by design; this records the real outcomes and settles all 38 picks.
--
--   Final:      Spain 1-0 Argentina (a.e.t., Ferran Torres 106') -> Spain champions
--   Third place: England 6-4 France (already auto-settled)
--   Golden Boot:  Kylian Mbappé  (10 goals in the openfootball dataset the league uses)
--   Golden Glove: Unai Simón
--   Young Player: Pau Cubarsí   (added to players_catalog so the result is recorded by
--                                identity rather than a sentinel; nobody picked him)
--   Total goals:  301           (300 across the first 103 matches + the Final)
--
--   apply: docker exec -i supabase_db_foodball psql -U postgres -d postgres -f - < this

begin;

-- The Young Player winner was never in the seeded catalog; record him properly so the
-- settled result is auditable (this does NOT make him pickable — picks are long closed).
insert into public.players_catalog (name, team, position)
select 'Pau Cubarsí', (select id from public.teams where fifa_code = 'ESP'), 'DF'
 where not exists (select 1 from public.players_catalog
                    where public.fb_name_key(name) = public.fb_name_key('Pau Cubarsí'));

-- 1. The Final — Spain 1-0 Argentina after extra time.
update public.matches
   set home_score = 1, away_score = 0, home_score_et = 1, away_score_et = 0,
       winner = (select id from public.teams where fifa_code = 'ESP'),
       status = 'finished', result_source = 'manual', updated_at = now()
 where api_match_id = 'WC26-F-104';
select public.fb_score_match((select id from public.matches where api_match_id = 'WC26-F-104'));

-- 2. Tournament-long results. `finalist` takes TWO rows (a pick matches either).
delete from public.tournament_results;
insert into public.tournament_results (pick_type, selection) values
  ('champion',     (select id::text from public.teams where fifa_code = 'ESP')),
  ('finalist',     (select id::text from public.teams where fifa_code = 'ESP')),
  ('finalist',     (select id::text from public.teams where fifa_code = 'ARG')),
  ('golden_boot',  (select id::text from public.players_catalog where name = 'Kylian Mbappé')),
  ('golden_glove', (select id::text from public.players_catalog where name = 'Unai Simón')),
  ('young_player', (select id::text from public.players_catalog
                     where public.fb_name_key(name) = public.fb_name_key('Pau Cubarsí'))),
  ('total_goals',  '301');
select public.fb_score_tournament();

commit;
