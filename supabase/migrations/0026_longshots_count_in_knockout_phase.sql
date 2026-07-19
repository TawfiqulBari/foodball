-- FoodBall — tournament long-shots count in the KNOCKOUT phase.
--
-- `0025` split every score_event into phase 1 (group: MD1–R32) or phase 2 (knockout:
-- R16–Final) by the round it was earned in, and parked the tournament long-shots
-- (champion / finalist / golden boot / golden glove / young player / total goals) in
-- phase 1 as a conservative default — at the time they were all unsettled (0 points),
-- so the choice was inert.
--
-- At the end of the tournament they settle all at once and are worth a lot (a champion
-- pick is up to 100). Leaving them in phase 1 would retroactively inflate the *frozen*
-- group score and rescale `group_score` for everyone — pushing down players who simply
-- never made a long-shot pick. That breaks the "group stage is frozen at end of R32"
-- guarantee the two-phase model is built on.
--
-- Owner's decision: long-shots resolve at the END of the tournament, so they belong to
-- the knockout phase. This keeps the frozen group genuinely frozen and keeps the final
-- score on the clean 0–100 scale. Only the phase tag changes; the blend, weights and
-- normalisation are untouched.

create or replace view public.leaderboard
with (security_invoker = true) as
with cfg as (
  select coalesce(two_phase_enabled, false) as tp,
         coalesce(group_weight, 0.30)       as gw,
         coalesce(knockout_weight, 0.70)    as kw
    from public.settings where id
),
ev as (
  select se.user_id, se.points, se.reason,
    case
      when se.source_table = 'match_picks' then (
        select case when m.round_key in ('MD1','MD2','MD3','R32') then 1 else 2 end
          from public.match_picks mp join public.matches m on m.id = mp.match_id
         where mp.id = se.source_id)
      when se.source_table = 'round_props' then (
        select case when rp.round_key in ('MD1','MD2','MD3','R32') then 1 else 2 end
          from public.round_props rp where rp.id = se.source_id)
      else 2                       -- tournament long-shots settle at the end -> knockout
    end as phase
  from public.score_events se
),
totals as (
  select p.id as user_id, p.display_name, p.avatar_config,
    coalesce(sum(e.points), 0)::integer                            as raw_total,
    coalesce(sum(e.points) filter (where e.phase = 1), 0)::integer as group_pts,
    coalesce(sum(e.points) filter (where e.phase = 2), 0)::integer as ko_pts,
    count(*) filter (where e.reason like 'exact:%'   and e.points > 0)::integer as exact_hits,
    count(*) filter (where e.reason like 'outcome:%' and e.points > 0)::integer as outcome_hits
  from public.profiles p
  left join ev e on e.user_id = p.id
  group by p.id, p.display_name, p.avatar_config
),
mx as (
  select greatest(max(group_pts), 1) as max_group, max(ko_pts) as max_ko from totals
),
scored as (
  select t.*,
    round(t.group_pts::numeric / (select max_group from mx) * 100)::integer as group_score,
    case when (select max_ko from mx) > 0
         then round(t.ko_pts::numeric / (select max_ko from mx) * 100)::integer
         else 0 end as knockout_score
  from totals t
),
ranked as (
  select s.user_id, s.display_name, s.avatar_config, s.exact_hits, s.outcome_hits,
    s.raw_total, s.group_score, s.knockout_score,
    round(case when (select tp from cfg)
               then (select gw from cfg) * s.group_score + (select kw from cfg) * s.knockout_score
               else s.raw_total end)::integer as total
  from scored s
),
final as (
  select r.*, rank() over (order by r.total desc)::integer as rank from ranked r
)
select f.user_id, f.display_name, f.avatar_config, f.total,
       f.exact_hits, f.outcome_hits, f.rank,
       coalesce((select rh.rank from public.rank_history rh
                  where rh.user_id = f.user_id
                  order by rh.captured_at desc limit 1) - f.rank, 0) as rank_delta,
       f.group_score, f.knockout_score, f.raw_total
  from final f;
