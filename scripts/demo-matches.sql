-- Demo fixtures for the live tryout (run as superuser → bypasses RLS). Idempotent.
-- A handful of upcoming MD1 group games, a couple with a designated underdog (×2),
-- so the Matches screen is playable immediately. Real fixtures come from
-- sync-fixtures (needs an API token) or the admin panel.
insert into public.matches
  (api_match_id, round_key, group_letter, home_team, away_team, kickoff, underdog_team, status, result_source)
values
  ('DEMO-1', 'MD1', 'A',
   (select id from public.teams where fifa_code='ARG'),
   (select id from public.teams where fifa_code='MAR'),
   now() + interval '6 hours',
   (select id from public.teams where fifa_code='MAR'), 'scheduled', 'api'),
  ('DEMO-2', 'MD1', 'D',
   (select id from public.teams where fifa_code='USA'),
   (select id from public.teams where fifa_code='GHA'),
   now() + interval '1 day',
   (select id from public.teams where fifa_code='GHA'), 'scheduled', 'api'),
  ('DEMO-3', 'MD1', 'C',
   (select id from public.teams where fifa_code='BRA'),
   (select id from public.teams where fifa_code='GER'),
   now() + interval '1 day 3 hours',
   null, 'scheduled', 'api'),
  ('DEMO-4', 'MD1', 'B',
   (select id from public.teams where fifa_code='FRA'),
   (select id from public.teams where fifa_code='JPN'),
   now() + interval '2 days',
   (select id from public.teams where fifa_code='JPN'), 'scheduled', 'api'),
  ('DEMO-5', 'MD1', 'E',
   (select id from public.teams where fifa_code='MEX'),
   (select id from public.teams where fifa_code='CAN'),
   now() + interval '2 days 3 hours',
   null, 'scheduled', 'api')
on conflict (api_match_id) do nothing;
