-- FoodBall — self-driving knockout fixture import (no admin, no Node script).
--
-- Why: a knockout round only enters the league if its fixtures are imported BEFORE
-- kickoff. That import was a manual `node scripts/import-real-fixtures.mjs` re-run
-- per round — and it was MISSED for the quarter-finals (played Jul 9-11, never
-- imported: no matches, no picks, no specials; the round had to be written off).
-- This closes that hole for the rest of the tournament (3rd place + Final) and for
-- any future run: pg_cron polls openfootball and imports each knockout fixture the
-- moment its teams resolve.
--
-- What it does, per openfootball knockout match:
--   * skips it unless BOTH teams are real (placeholders like "W101"/"L101" wait);
--   * skips it if kickoff has already passed and it isn't in the DB (never retro-add
--     a played round — results are public, so picks would be made with hindsight);
--   * inserts it (idempotent on api_match_id 'WC26-<RK>-<num>'), never touching an
--     existing row's result/status;
--   * sets the round's `first_kickoff` to the true earliest kickoff (so the round
--     specials lock at the real time, not the stale seed placeholder);
--   * designates `underdog_team` = the lower FIFA-ranked side, so Spice + the upset
--     x2 are live from the moment the fixture appears (only when both ranks are known
--     and differ; admin can always override via fb_admin_set_underdog).
--
-- Safe by construction: it only ever ADDS not-yet-played fixtures. Results still come
-- from the existing openfootball settler (0020) and admin entry still wins.

create or replace function public.fb_import_knockout_fixtures_json(p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m          jsonb;
  v_round    text;
  v_rk       text;
  v_num      text;
  v_api      text;
  v_home     bigint;
  v_away     bigint;
  v_hr       int;
  v_ar       int;
  v_kick     timestamptz;
  v_dog      bigint;
  v_n        int := 0;
  v_rk_touch text[] := '{}';
begin
  for m in select * from jsonb_array_elements(coalesce(p -> 'matches', '[]'::jsonb))
  loop
    v_round := m ->> 'round';
    v_rk := case v_round
      when 'Round of 32' then 'R32' when 'Round of 16' then 'R16'
      when 'Quarter-final' then 'QF' when 'Semi-final' then 'SF'
      when 'Match for third place' then 'F' when 'Final' then 'F' end;
    continue when v_rk is null;                         -- group stage / unknown

    -- Both teams must be REAL (openfootball uses W101/L101 placeholders until resolved).
    select id into v_home from public.teams where name = m ->> 'team1';
    select id into v_away from public.teams where name = m ->> 'team2';
    continue when v_home is null or v_away is null;

    v_num  := m ->> 'num';
    v_api  := 'WC26-' || v_rk || '-' || v_num;
    v_kick := public.fb_of_kickoff(m ->> 'date', m ->> 'time');
    continue when v_kick is null;

    -- Never retro-add a fixture that already kicked off but isn't in the league:
    -- its result is public, so picks would be hindsight. (An existing row is fine —
    -- the upsert below leaves its result/status alone.)
    continue when v_kick <= now()
             and not exists (select 1 from public.matches where api_match_id = v_api);

    insert into public.matches (api_match_id, round_key, group_letter, home_team, away_team,
                                kickoff, status, result_source)
    values (v_api, v_rk, null, v_home, v_away, v_kick, 'scheduled', 'api')
    on conflict (api_match_id) do update
      set home_team = excluded.home_team,
          away_team = excluded.away_team,
          kickoff   = excluded.kickoff
      where public.matches.status = 'scheduled';        -- never disturb a live/finished match

    if found then
      v_n := v_n + 1;
      v_rk_touch := array_append(v_rk_touch, v_rk);
    end if;

    -- Underdog = lower FIFA-ranked side (powers Spice + the upset x2). Only set it if
    -- it isn't already set (admin designation always wins) and the ranks are known.
    select fifa_rank into v_hr from public.teams where id = v_home;
    select fifa_rank into v_ar from public.teams where id = v_away;
    if v_hr is not null and v_ar is not null and v_hr <> v_ar then
      v_dog := case when v_hr > v_ar then v_home else v_away end;  -- bigger rank number = weaker
      update public.matches set underdog_team = v_dog, updated_at = now()
       where api_match_id = v_api and underdog_team is null and status = 'scheduled';
    end if;
  end loop;

  -- Round lock times: the true earliest kickoff of each round we touched.
  update public.rounds r
     set first_kickoff = sub.min_ko
    from (select round_key, min(kickoff) as min_ko
            from public.matches
           where round_key = any(v_rk_touch)
           group by round_key) sub
   where r.key = sub.round_key
     and r.first_kickoff is distinct from sub.min_ko
     and not r.completed;

  return v_n;
end;
$$;

-- openfootball's "12:00 UTC-7" style time -> timestamptz (mirrors kickoffISO() in
-- scripts/import-real-fixtures.mjs).
create or replace function public.fb_of_kickoff(p_date text, p_time text)
returns timestamptz
language plpgsql
immutable
as $$
declare v_hm text; v_off text;
begin
  if p_date is null or p_time is null then return null; end if;
  v_hm  := split_part(p_time, ' ', 1);
  v_off := coalesce(nullif(substring(p_time from 'UTC([+-][0-9]+)'), ''), '+0');
  return (p_date || ' ' || v_hm || ':00' ||
          case when left(v_off,1) = '-' then '-' else '+' end ||
          lpad(ltrim(v_off, '+-'), 2, '0'))::timestamptz;
exception when others then
  return null;
end;
$$;

-- Fetch + import wrapper (mirrors fb_sync_openfootball_results from 0014).
create or replace function public.fb_sync_knockout_fixtures()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_body text; v_status int;
begin
  if not exists (select 1 from pg_extension where extname = 'http') then
    raise notice 'fb_sync_knockout_fixtures: http extension absent — skipping';
    return 0;
  end if;
  begin
    select status, content into v_status, v_body
      from http_get('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
  exception when others then
    raise notice 'fb_sync_knockout_fixtures: fetch failed (%) — skipping', sqlerrm;
    return 0;
  end;
  if v_status <> 200 then
    raise notice 'fb_sync_knockout_fixtures: HTTP % — skipping', v_status;
    return 0;
  end if;
  return public.fb_import_knockout_fixtures_json(v_body::jsonb);
end;
$$;

revoke all on function public.fb_import_knockout_fixtures_json(jsonb) from public;
revoke all on function public.fb_sync_knockout_fixtures() from public;

-- Every 15 minutes: as soon as the semis finish and openfootball names the finalists,
-- the Final + 3rd-place fixtures appear in the league automatically — with the right
-- kickoff, lock time and underdog — with no admin action.
select cron.unschedule('foodball-knockout-fixtures')
  where exists (select 1 from cron.job where jobname = 'foodball-knockout-fixtures');
select cron.schedule('foodball-knockout-fixtures', '*/15 * * * *',
                     $$select public.fb_sync_knockout_fixtures();$$);
