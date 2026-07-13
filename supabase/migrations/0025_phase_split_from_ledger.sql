-- FoodBall — derive the two-phase split from the LEDGER, not a frozen snapshot.
--
-- Bug this fixes (found while wiring up auto Top Chef, 0024): the leaderboard computed
--     knockout_pts = raw_total - phase1_frozen.points
-- i.e. "everything not in the end-of-R32 snapshot is knockout points". That is only
-- true while no group-stage score ever changes again. When 0024's fb_score_round call
-- re-settled the group rounds, it credited +170 of Clean Plate points that had never
-- been awarded — and because those points were NOT in the snapshot, they were counted
-- as KNOCKOUT points, inflating two players' knockout scores (Zoyaza 71->79,
-- shahriar 54->63) and reordering the board.
--
-- Fix: compute each phase directly from what the points are FOR. A score_event belongs
-- to the phase of the round its source pick belongs to:
--   * match_picks  -> matches.round_key
--   * round_props  -> round_props.round_key
--   * tourney_picks (long-shots) -> group phase (they're set/decayed across the whole
--     tournament and were part of the frozen table; keeping them in phase 1 preserves
--     the "group form" meaning and can't leak into the knockout sprint).
-- Rounds MD1/MD2/MD3/R32 = phase 1 (group); R16/QF/SF/F = phase 2 (knockout).
--
-- phase1_frozen is kept (it still records the end-of-R32 table for reference/audit and
-- is what the UI can show as "frozen group points"), but the leaderboard no longer
-- DEPENDS on it for the split — so a late correction to a group round now stays in the
-- group phase automatically, and re-settling any round is safe forever.

-- Every score_event is tagged with the phase of the round it was earned in, then
-- summed per player — one pass, no snapshot dependency.
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
      else 1
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
