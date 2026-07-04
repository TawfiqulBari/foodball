-- FoodBall — point penalty for a WRONG outcome (W/D/W) pick.
--
-- A wrong outcome pick now costs points, but ONLY:
--   * on the "outcome" market (side markets exact/BTTS/over-under and the tournament
--     long-shots are never penalized — penalizing a 25-pt moonshot would kill the fun);
--   * from a chosen round forward (`settings.penalty_from_round`, by rounds.sort_order)
--     so already-scored rounds are never retroactively changed;
--   * when enabled (`settings.wrong_outcome_penalty > 0`).
-- A MISSED pick has no match_picks row, so it is unaffected (Skipped Lunch = 0).
-- The score_events ledger already allows negative points, so the leaderboard view
-- reflects the deduction automatically. Admin-tunable, no code change to re-tune.

alter table public.settings
  add column if not exists wrong_outcome_penalty int  not null default 0,
  add column if not exists penalty_from_round    text;

comment on column public.settings.wrong_outcome_penalty is
  'Points deducted for a wrong outcome (W/D/W) pick; 0 = disabled.';
comment on column public.settings.penalty_from_round is
  'Round key from which the wrong-outcome penalty applies (by rounds.sort_order); NULL = none.';

-- Agreed rule: -5 for a wrong outcome, from the Round of 16 onward.
update public.settings set wrong_outcome_penalty = 5, penalty_from_round = 'R16' where id;

-- Re-define the match scorer with the penalty. Everything else is unchanged from
-- 0019 (exact/BTTS/OU scoring, upset ×2, score_events upsert, self-correcting
-- round completion).
create or replace function public.fb_score_match(p_match_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  m          public.matches%rowtype;
  v_outcome  text; v_exact text; v_btts text; v_ou text;
  v_upset    boolean; v_all_done boolean;
  v_penalty  int; v_pen_from_sort int; v_penalty_active boolean;
begin
  select * into m from public.matches where id = p_match_id;
  if not found or m.status <> 'finished' or m.home_score is null or m.away_score is null then
    return;
  end if;

  if m.winner is not null then
    v_outcome := case when m.winner = m.home_team then 'home'
                      when m.winner = m.away_team then 'away' else 'draw' end;
  elsif m.home_score > m.away_score then v_outcome := 'home';
  elsif m.home_score < m.away_score then v_outcome := 'away';
  else v_outcome := 'draw';
  end if;

  v_exact := coalesce(m.home_score_et, m.home_score)::text || '-' ||
             coalesce(m.away_score_et, m.away_score)::text;
  v_btts  := case when m.home_score > 0 and m.away_score > 0 then 'yes' else 'no' end;
  v_ou    := case when (m.home_score + m.away_score) >= 3 then 'over' else 'under' end;
  v_upset := v_outcome <> 'draw' and m.underdog_team is not null
         and ((v_outcome = 'home' and m.underdog_team = m.home_team)
           or (v_outcome = 'away' and m.underdog_team = m.away_team));

  -- Wrong-outcome penalty: enabled, and this match's round is at/after the start round.
  select s.wrong_outcome_penalty,
         (select r.sort_order from public.rounds r where r.key = s.penalty_from_round)
    into v_penalty, v_pen_from_sort
    from public.settings s where s.id;
  v_penalty_active := coalesce(v_penalty, 0) > 0
    and v_pen_from_sort is not null
    and coalesce((select sort_order from public.rounds where key = m.round_key), 0) >= v_pen_from_sort;

  with scored as (
    select mp.id, mp.user_id, mp.market,
      case mp.market
        when 'outcome'     then case when mp.selection = v_outcome
                                     then 10 * (case when v_upset then 2 else 1 end)
                                     when v_penalty_active then - v_penalty
                                     else 0 end
        when 'exact_score' then case when mp.selection = v_exact then 25 else 0 end
        when 'btts'        then case when mp.selection = v_btts  then 5  else 0 end
        when 'over_under'  then case when mp.selection = v_ou    then 5  else 0 end
        else 0
      end as pts,
      case mp.market
        when 'outcome'     then 'outcome:' || v_outcome
        when 'exact_score' then 'exact:'   || mp.selection
        else mp.market || ':' || mp.selection
      end as reason
    from public.match_picks mp
    where mp.match_id = p_match_id
  ),
  upd as (
    update public.match_picks mp set points_awarded = s.pts
      from scored s where mp.id = s.id returning mp.id
  )
  insert into public.score_events (user_id, source_table, source_id, points, reason)
  select s.user_id, 'match_picks', s.id, s.pts, s.reason from scored s
  on conflict (source_table, source_id)
    do update set points = excluded.points, reason = excluded.reason, created_at = now();

  -- Self-correcting completion: completed tracks the CURRENT all-finished state.
  select bool_and(status = 'finished') into v_all_done
    from public.matches where round_key = m.round_key;
  update public.rounds set completed = coalesce(v_all_done, false)
   where key = m.round_key and completed is distinct from coalesce(v_all_done, false);
  if coalesce(v_all_done, false) then
    perform public.fb_score_round(m.round_key);
  end if;
end; $$;
