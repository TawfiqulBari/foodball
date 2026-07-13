-- FoodBall — automatic Top Chef settlement (round top scorers from openfootball).
--
-- Why: "Top Chef" (pick the round's top scorer, 15 pts) settles off
-- `public.round_top_scorers`, which is ADMIN-ENTERED and had never been populated —
-- so Top Chef paid out **0 for every round of the tournament** (R32 and R16 both
-- settled to zero). Players were picking a prop that could not score.
--
-- openfootball publishes goalscorers (`goals1`/`goals2` arrays of {name, minute}),
-- so this derives each round's top scorer(s) in-DB and fills `round_top_scorers`,
-- then re-settles the round. Runs on the same pg_cron loop as the results sync.
--
-- Rules / guards:
--   * only FINISHED matches count, and only rounds where EVERY match is finished
--     (a part-played round has no meaningful "top scorer" yet);
--   * own goals are excluded (openfootball flags them `owngoal: true`);
--   * ties are honoured — ALL players on the max goal count are inserted, so any of
--     them wins the pick (matches the existing `exists(...)` settlement in fb_score_round);
--   * scorer names are matched to `players_catalog` accent-insensitively; a scorer we
--     cannot resolve is skipped, which is safe: the picker only offers catalog players,
--     so an unpickable name can never have been chosen anyway;
--   * the round is only rewritten when the computed set differs, and `fb_score_round`
--     is idempotent (score_events upsert), so re-running never double-pays.

-- Accent/case-insensitive name key ("Kylián Mbappé" -> "kylian mbappe").
create or replace function public.fb_name_key(p text)
returns text language sql immutable as $$
  select lower(trim(regexp_replace(
    translate(coalesce(p, ''),
      'ÁÀÂÄÃÅáàâäãåÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÖÕóòôöõÚÙÛÜúùûüÑñÇçŠšŽžĐđŁłİı',
      'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCcSsZzDdLlIi'),
    '[^a-zA-Z ]', '', 'g')));
$$;

-- PURE: given an openfootball payload, refresh round_top_scorers for every COMPLETE
-- knockout/group round and re-settle it. Returns the number of rounds updated.
create or replace function public.fb_sync_top_scorers_json(p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r          record;
  v_updated  int := 0;
begin
  -- 1. Flatten every goal from every played match into (round_key, scorer name).
  create temp table _goals on commit drop as
  with m as (
    select
      case m.value ->> 'round'
        when 'Round of 32' then 'R32' when 'Round of 16' then 'R16'
        when 'Quarter-final' then 'QF' when 'Semi-final' then 'SF'
        when 'Match for third place' then 'F' when 'Final' then 'F'
        else case when (m.value ->> 'group') like 'Group%' then null else null end
      end as round_key,
      m.value as match
    from jsonb_array_elements(coalesce(p -> 'matches', '[]'::jsonb)) m(value)
  ),
  md as (  -- group-stage rounds carry a "Matchday N" round label
    select coalesce(m.round_key,
             case m.match ->> 'round'
               when 'Matchday 1' then 'MD1' when 'Matchday 2' then 'MD2'
               when 'Matchday 3' then 'MD3' end) as round_key,
           m.match
      from m
  )
  select md.round_key,
         public.fb_name_key(g.value ->> 'name') as name_key
    from md,
         lateral (
           select value from jsonb_array_elements(coalesce(md.match -> 'goals1', '[]'::jsonb))
           union all
           select value from jsonb_array_elements(coalesce(md.match -> 'goals2', '[]'::jsonb))
         ) g(value)
   where md.round_key is not null
     and coalesce((g.value ->> 'owngoal')::boolean, false) = false   -- own goals don't count
     and nullif(g.value ->> 'name', '') is not null;

  -- 2. Per COMPLETE round, resolve the top scorer(s) to catalog players.
  for r in
    with tally as (
      select g.round_key, g.name_key, count(*) as goals
        from _goals g
       group by g.round_key, g.name_key
    ),
    top as (
      select t.round_key, t.name_key,
             rank() over (partition by t.round_key order by t.goals desc) as rnk
        from tally t
    ),
    resolved as (   -- only rounds where every match in our DB is finished
      select tp.round_key, pc.id as player_id
        from top tp
        join public.players_catalog pc on public.fb_name_key(pc.name) = tp.name_key
       where tp.rnk = 1
         and exists (select 1 from public.matches mm where mm.round_key = tp.round_key)
         and not exists (select 1 from public.matches mm
                          where mm.round_key = tp.round_key and mm.status <> 'finished')
       group by tp.round_key, pc.id
    )
    select rr.round_key, array_agg(rr.player_id order by rr.player_id) as player_ids
      from resolved rr group by rr.round_key
  loop
    -- 3. Only rewrite when the set actually changes, then re-settle the round.
    if exists (
      select 1
      from (select player_id from public.round_top_scorers where round_key = r.round_key) cur
      full outer join unnest(r.player_ids) as new_id on new_id = cur.player_id
      where cur.player_id is null or new_id is null
    ) then
      delete from public.round_top_scorers where round_key = r.round_key;
      insert into public.round_top_scorers (round_key, player_id)
        select r.round_key, unnest(r.player_ids)
        on conflict do nothing;
      perform public.fb_score_round(r.round_key);
      v_updated := v_updated + 1;
      raise notice '0024: % top scorer(s) set for %', array_length(r.player_ids, 1), r.round_key;
    end if;
  end loop;

  return v_updated;
end;
$$;

-- Fetch + sync wrapper (mirrors fb_sync_openfootball_results from 0014).
create or replace function public.fb_sync_top_scorers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_body text; v_status int;
begin
  if not exists (select 1 from pg_extension where extname = 'http') then
    raise notice 'fb_sync_top_scorers: http extension absent — skipping';
    return 0;
  end if;
  begin
    select status, content into v_status, v_body
      from http_get('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json');
  exception when others then
    raise notice 'fb_sync_top_scorers: fetch failed (%) — skipping', sqlerrm;
    return 0;
  end;
  if v_status <> 200 then
    raise notice 'fb_sync_top_scorers: HTTP % — skipping', v_status;
    return 0;
  end if;
  return public.fb_sync_top_scorers_json(v_body::jsonb);
end;
$$;

revoke all on function public.fb_sync_top_scorers_json(jsonb) from public;
revoke all on function public.fb_sync_top_scorers() from public;

-- Every 20 minutes: a round's Top Chef settles itself once the round's last match is
-- final and openfootball has published the scorers. No admin action.
select cron.unschedule('foodball-top-scorers')
  where exists (select 1 from cron.job where jobname = 'foodball-top-scorers');
select cron.schedule('foodball-top-scorers', '*/20 * * * *',
                     $$select public.fb_sync_top_scorers();$$);
