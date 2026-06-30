-- FoodBall — extend the token-free openfootball auto-settle to KNOCKOUT matches.
--
-- `0014`'s settler was group-stage only (`continue when group not like 'Group%'`),
-- so finished R32/R16/QF/SF/F ties stayed stuck "awaiting result" — auto-live flips
-- them to `live` at kickoff but nothing ever settles them. This rewrites the pure
-- settler to also handle knockouts.
--
-- A knockout needs more than a 90' score: the W/D/W "outcome" market is scored from
-- `matches.winner` (see fb_score_match's winner-precedence branch), so we must record
-- the team that ADVANCED. openfootball publishes that as a penalty score (`score.p`),
-- an extra-time score (`score.et`), or — for ties settled in 90 — the full-time score.
-- We derive the winner penalties → ET → 90', store ET scores (the exact-score market
-- reads coalesce(score_et, score)), and leave a still-drawn-with-no-shootout result
-- unsettled until openfootball fills it in.
--
-- The group-stage path is byte-for-byte unchanged. Manual admin entry still always
-- wins (a finished `result_source='manual'` match is never overwritten). Idempotent:
-- re-settles only when the score or winner actually changed. The fetch wrapper
-- `fb_sync_openfootball_results()` + its 10-min cron call this, so knockouts now
-- self-settle going forward with no admin action.

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
  v_src     text;
  v_cw      bigint;
  v_ch      int;
  v_ca      int;
  v_h       int;
  v_a       int;
  v_het     int;
  v_aet     int;
  v_ph      int;
  v_pa      int;
  v_is_ko   boolean;
  v_winner  bigint;
  v_n       int := 0;
begin
  for m in select * from jsonb_array_elements(coalesce(p -> 'matches', '[]'::jsonb))
  loop
    v_is_ko := coalesce(m ->> 'group', '') not like 'Group%';

    -- Final 90' score — support openfootball's score1/score2 and score.ft[] shapes.
    v_h := coalesce(nullif(m ->> 'score1', '')::int, (m -> 'score' -> 'ft' ->> 0)::int);
    v_a := coalesce(nullif(m ->> 'score2', '')::int, (m -> 'score' -> 'ft' ->> 1)::int);
    continue when v_h is null or v_a is null;

    -- openfootball team names were seeded verbatim into teams.name at import.
    select id into v_home_id from public.teams where name = m ->> 'team1';
    select id into v_away_id from public.teams where name = m ->> 'team2';
    continue when v_home_id is null or v_away_id is null;

    -- Resolve to OUR row, disambiguating group vs knockout by group_letter (a group
    -- pair and a later knockout pair could coincide).
    select api_match_id, status, home_score, away_score, result_source, winner
      into v_api, v_status, v_ch, v_ca, v_src, v_cw
      from public.matches
     where home_team = v_home_id and away_team = v_away_id
       and (group_letter is null) = v_is_ko;
    continue when v_api is null;
    -- Manual entry always wins.
    continue when v_src = 'manual' and v_status = 'finished';

    if not v_is_ko then
      -- Group stage — unchanged: already settled to this exact score → nothing to do.
      continue when v_status = 'finished' and v_ch = v_h and v_ca = v_a;
      begin
        perform public.fb_ingest_result(v_api, v_h, v_a, 'finished');
        v_n := v_n + 1;
      exception when others then
        raise notice '0020: settle % failed: %', v_api, sqlerrm;
      end;
    else
      -- Knockout: capture ET + the advancing winner (penalties → ET → 90').
      v_het := nullif(m -> 'score' -> 'et' ->> 0, '')::int;
      v_aet := nullif(m -> 'score' -> 'et' ->> 1, '')::int;
      v_ph  := nullif(m -> 'score' -> 'p'  ->> 0, '')::int;
      v_pa  := nullif(m -> 'score' -> 'p'  ->> 1, '')::int;
      v_winner := case
        when v_ph is not null and v_pa is not null then
          case when v_ph > v_pa then v_home_id when v_pa > v_ph then v_away_id end
        when v_het is not null and v_aet is not null and v_het <> v_aet then
          case when v_het > v_aet then v_home_id else v_away_id end
        when v_h <> v_a then
          case when v_h > v_a then v_home_id else v_away_id end
        else null  -- drawn with no shootout data yet → wait for a complete result
      end;
      continue when v_winner is null;
      -- Idempotent: already finished with the same score + advancing winner → skip.
      continue when v_status = 'finished' and v_ch = v_h and v_ca = v_a
                and v_cw is not distinct from v_winner;
      begin
        update public.matches
           set home_score = v_h, away_score = v_a,
               home_score_et = v_het, away_score_et = v_aet,
               winner = v_winner, status = 'finished',
               result_source = 'api', updated_at = now()
         where api_match_id = v_api;
        perform public.fb_score_match((select id from public.matches where api_match_id = v_api));
        v_n := v_n + 1;
      exception when others then
        raise notice '0020: KO settle % failed: %', v_api, sqlerrm;
      end;
    end if;
  end loop;
  return v_n;
end;
$$;

revoke all on function public.fb_settle_from_openfootball_json(jsonb) from public;
