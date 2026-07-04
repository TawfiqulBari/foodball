-- FoodBall — two-phase weighted leaderboard ("factor of 100", fresh from R16).
--
-- The group stage + R32 are FROZEN and normalised to a 0-100 "group score" (leader
-- = 100, others proportional). The knockouts (R16 -> Final) are scored FRESH and
-- normalised to a 0-100 "knockout score" LIVE (current knockout leader = 100). The
-- leaderboard total becomes a weighted blend:
--     total = group_weight * group_score + knockout_weight * knockout_score
-- Default weights 0.30 / 0.70 (admin-tunable). Everything is gated behind
-- settings.two_phase_enabled (default FALSE) so it can be flipped on/off instantly
-- with zero data change; OFF reproduces the old raw-points board exactly.
--
-- Phase split is by score_events timing: phase-1 = the frozen snapshot taken here
-- (end of R32, before any R16 points exist); phase-2 (knockouts) = raw_total minus
-- the frozen snapshot. Group-stage score_events never change afterwards (those
-- matches are final and the -5 penalty is gated to R16+), so the split is stable.

create table if not exists public.phase1_frozen (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  points  integer not null default 0
);
alter table public.phase1_frozen enable row level security;
drop policy if exists phase1_frozen_read on public.phase1_frozen;
create policy phase1_frozen_read on public.phase1_frozen for select using (true);

-- Snapshot the end-of-R32 standings (raw score_events total per player). Taken now,
-- before any R16 points exist, so it captures exactly the group+R32 table.
insert into public.phase1_frozen (user_id, points)
select p.id, coalesce(sum(se.points), 0)::int
  from public.profiles p
  left join public.score_events se on se.user_id = p.id
 group by p.id
on conflict (user_id) do update set points = excluded.points;

alter table public.settings
  add column if not exists two_phase_enabled boolean not null default false,
  add column if not exists group_weight      numeric not null default 0.30,
  add column if not exists knockout_weight   numeric not null default 0.70;

-- Rewrite the leaderboard: first 8 columns unchanged (so CREATE OR REPLACE is legal),
-- three new columns appended (group_score, knockout_score, raw_total). `total` becomes
-- the weighted blend when two_phase_enabled, else the raw points (old behaviour).
create or replace view public.leaderboard
with (security_invoker = true) as
with cfg as (
  select coalesce(two_phase_enabled, false) as tp,
         coalesce(group_weight, 0.30)       as gw,
         coalesce(knockout_weight, 0.70)    as kw
    from public.settings where id
),
totals as (
  select p.id as user_id, p.display_name, p.avatar_config,
    coalesce(sum(se.points), 0)::integer as raw_total,
    count(*) filter (where se.reason like 'exact:%'   and se.points > 0)::integer as exact_hits,
    count(*) filter (where se.reason like 'outcome:%' and se.points > 0)::integer as outcome_hits
  from public.profiles p
  left join public.score_events se on se.user_id = p.id
  group by p.id, p.display_name, p.avatar_config
),
phase as (
  select t.*,
    coalesce(f.points, 0)                     as group_pts,
    (t.raw_total - coalesce(f.points, 0))     as ko_pts
  from totals t
  left join public.phase1_frozen f on f.user_id = t.user_id
),
mx as (
  select greatest(max(group_pts), 1) as max_group, max(ko_pts) as max_ko from phase
),
scored as (
  select ph.*,
    round(ph.group_pts::numeric / (select max_group from mx) * 100)::integer as group_score,
    case when (select max_ko from mx) > 0
         then round(ph.ko_pts::numeric / (select max_ko from mx) * 100)::integer
         else 0 end as knockout_score
  from phase ph
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
