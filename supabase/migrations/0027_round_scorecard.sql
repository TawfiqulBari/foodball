-- FoodBall — per-player, per-round score breakdown for the public score card.
--
-- The leaderboard shows the blended `grp/100 | ko/100 | FINAL`, but players also want
-- to see WHERE the points came from — how much each chef scored in every round, plus
-- the long-shot payouts. This view exposes exactly that, one row per (user, round).
--
-- Every score_event is attributed to the round its source pick belongs to:
--   match_picks -> matches.round_key   |   round_props -> round_props.round_key
--   tourney_picks (champion/finalist/awards) -> the pseudo-round 'LONG'
-- `security_invoker` keeps the caller's RLS in force (score_events is readable), and
-- rounds are all locked/complete now so nothing here can leak an unlocked pick.

create or replace view public.round_scorecard
with (security_invoker = true) as
with ev as (
  select se.user_id, se.points,
    case
      when se.source_table = 'match_picks' then (
        select m.round_key from public.match_picks mp
          join public.matches m on m.id = mp.match_id
         where mp.id = se.source_id)
      when se.source_table = 'round_props' then (
        select rp.round_key from public.round_props rp where rp.id = se.source_id)
      else 'LONG'
    end as round_key
  from public.score_events se
)
select
  ev.user_id,
  ev.round_key,
  sum(ev.points)::integer                                as points,
  count(*) filter (where ev.points > 0)::integer         as hits,
  count(*)::integer                                      as scored_picks
from ev
where ev.round_key is not null
group by ev.user_id, ev.round_key;

grant select on public.round_scorecard to anon, authenticated;
