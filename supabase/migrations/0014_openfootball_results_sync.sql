-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — token-free auto-settle from openfootball (keyless, free).
--
-- The `foodball-auto-live` cron (0010) makes matches go LIVE at kickoff with no
-- API token. This is the other half: once openfootball publishes a final score,
-- a match settles ITSELF — no admin action — via fb_ingest_result (which scores
-- picks, cascades round-prop settlement, and fires goal/FT commentary). Manual
-- always wins: fb_ingest_result skips a match whose result_source='manual'.
--
-- Self-contained, in-DB: the pgsql `http` extension fetches openfootball directly
-- (the DB has egress on this self-hosted stack), and pg_cron runs it on a timer.
-- Inert where `http` is unavailable (e.g. hosted Supabase) — there the existing
-- `sync-results` Edge Function is the path instead. Group stage only (knockouts
-- carry placeholder team names + need ET/penalty winner logic).
--
-- Split into a PURE function (takes the JSON → settles; unit-testable) and a thin
-- fetch wrapper, so the settle logic can be tested without network.
-- Idempotent: CREATE OR REPLACE + cron.schedule() replaces a same-named job.
-- ════════════════════════════════════════════════════════════════════════════

-- Synchronous HTTP from Postgres. Guarded so the migration still applies where the
-- extension can't be installed (the sync just stays inert there).
do $$
begin
  create extension if not exists http;
exception when others then
  raise notice '0014: http extension unavailable — openfootball auto-sync will be inert (%).', sqlerrm;
end $$;

-- PURE: settle finished group-stage matches from an openfootball worldcup.json
-- payload. Returns the number of matches it handed to fb_ingest_result.
create or replace function public.fb_settle_from_openfootball_json(p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m         jsonb;
  v_home_id bigint;
  v_away_id bigint;
  v_api     text;
  v_status  text;
  v_ch      int;
  v_ca      int;
  v_h       int;
  v_a       int;
  v_n       int := 0;
begin
  for m in select * from jsonb_array_elements(coalesce(p -> 'matches', '[]'::jsonb))
  loop
    -- Group stage only.
    continue when coalesce(m ->> 'group', '') not like 'Group%';

    -- Final score — support openfootball's score1/score2 and score.ft[] shapes.
    v_h := coalesce(nullif(m ->> 'score1', '')::int, (m -> 'score' -> 'ft' ->> 0)::int);
    v_a := coalesce(nullif(m ->> 'score2', '')::int, (m -> 'score' -> 'ft' ->> 1)::int);
    continue when v_h is null or v_a is null;

    -- openfootball team names were seeded verbatim into teams.name at import.
    select id into v_home_id from public.teams where name = m ->> 'team1';
    select id into v_away_id from public.teams where name = m ->> 'team2';
    continue when v_home_id is null or v_away_id is null;

    select api_match_id, status, home_score, away_score
      into v_api, v_status, v_ch, v_ca
      from public.matches where home_team = v_home_id and away_team = v_away_id;
    continue when v_api is null;
    -- Already settled to this exact score → nothing to do (avoids needless re-score).
    continue when v_status = 'finished' and v_ch = v_h and v_ca = v_a;

    begin
      perform public.fb_ingest_result(v_api, v_h, v_a, 'finished');  -- manual results are skipped inside
      v_n := v_n + 1;
    exception when others then
      raise notice '0014: settle % failed: %', v_api, sqlerrm;
    end;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.fb_settle_from_openfootball_json(jsonb) from public;

-- WRAPPER: fetch openfootball and settle. No-op (returns 0) if http is missing or
-- the fetch fails, so a transient network blip never disrupts the DB.
create or replace function public.fb_sync_openfootball_results()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status int;
  v_body   text;
begin
  if not exists (select 1 from pg_extension where extname = 'http') then
    raise notice 'fb_sync_openfootball_results: http extension absent — skipping';
    return 0;
  end if;

  perform set_config('http.timeout_msec', '8000', true);
  begin
    select status, content into v_status, v_body
      from http_get('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
  exception when others then
    raise notice 'fb_sync_openfootball_results: fetch failed (%) — skipping', sqlerrm;
    return 0;
  end;
  if v_status is distinct from 200 or v_body is null then
    raise notice 'fb_sync_openfootball_results: HTTP % — skipping', v_status;
    return 0;
  end if;

  return public.fb_settle_from_openfootball_json(v_body::jsonb);
end;
$$;

revoke all on function public.fb_sync_openfootball_results() from public;

-- Every 10 minutes. No-ops cheaply until openfootball publishes a final score.
select cron.schedule('foodball-openfootball-sync', '*/10 * * * *',
                     $$select public.fb_sync_openfootball_results();$$);
