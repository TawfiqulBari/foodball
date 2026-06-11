-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — Milestone 3: auto-sync results pipeline, manual-override precedence,
-- rank-change deltas, and Realtime wiring.
--
-- Applied after 0002 (local harness mounts it as 01c_m3.sql; hosted Supabase: the
-- next migration). The acceptance crux (spec §9): a simulated API payload settles
-- a match END-TO-END with no admin action, and a manual result entered first is
-- NEVER overwritten by a later API poll.
--
-- NOTE ON THE LEADERBOARD: the M1 comment anticipated a materialized view in M3.
-- For ~20–50 players a plain security_invoker VIEW is always-consistent and fast
-- enough, and it sidesteps REFRESH-CONCURRENTLY/RLS friction — so we keep the view
-- and instead add rank_delta from a per-round rank snapshot. (Swap to a matview
-- only if the player count ever makes the live view too slow.)
-- ════════════════════════════════════════════════════════════════════════════

-- Snapshot of standings captured when each round completes — powers rank_delta
-- (the "▲/▼ since last round" arrows, spec §7.3).
create table public.rank_history (
  round_key   text not null references public.rounds(key),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  rank        int  not null,
  total       int  not null,
  captured_at timestamptz not null default now(),
  primary key (round_key, user_id)
);

alter table public.rank_history enable row level security;
create policy rank_history_read on public.rank_history for select to authenticated using (true);

-- ════════════════════════════════════════════════════════════════════════════
-- LEADERBOARD — same columns + shape, but rank_delta is now the user's previous
-- snapshot rank minus their current rank (positive = climbed). 0 if no snapshot.
-- ════════════════════════════════════════════════════════════════════════════
create or replace view public.leaderboard
with (security_invoker = true)
as
  with totals as (
    select
      p.id                                                                as user_id,
      p.display_name,
      p.avatar_config,
      coalesce(sum(se.points), 0)::int                                    as total,
      count(*) filter (where se.reason like 'exact:%'   and se.points > 0)::int as exact_hits,
      count(*) filter (where se.reason like 'outcome:%' and se.points > 0)::int as outcome_hits
    from public.profiles p
    left join public.score_events se on se.user_id = p.id
    group by p.id, p.display_name, p.avatar_config
  ),
  ranked as (
    select t.*, rank() over (order by t.total desc)::int as rank from totals t
  )
  select
    r.user_id, r.display_name, r.avatar_config, r.total, r.exact_hits, r.outcome_hits, r.rank,
    coalesce(
      (select rh.rank from public.rank_history rh
        where rh.user_id = r.user_id order by rh.captured_at desc limit 1) - r.rank,
      0
    )::int as rank_delta
  from ranked r;

-- Capture the current standings as the snapshot for a round (idempotent).
create or replace function public.fb_snapshot_ranks(p_round_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rank_history (round_key, user_id, rank, total)
  select p_round_key, lb.user_id, lb.rank, lb.total from public.leaderboard lb
  on conflict (round_key, user_id)
    do update set rank = excluded.rank, total = excluded.total, captured_at = now();
end;
$$;

-- Re-define fb_score_round (from 0002) to snapshot ranks once the round's points
-- are all in — so the next round shows correct rank-change arrows.
create or replace function public.fb_score_round(p_round_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with scored as (
    select rp.id, rp.user_id, rp.prop,
      case rp.prop
        when 'top_chef' then case when exists (
              select 1 from public.round_top_scorers ts
               where ts.round_key = p_round_key and ts.player_id::text = rp.selection)
            then 15 else 0 end
        when 'clean_plate' then case when exists (
              select 1 from public.players_catalog pc
              join public.matches mt on mt.round_key = p_round_key and mt.status = 'finished'
               where pc.id::text = rp.selection
                 and ((mt.home_team = pc.team and mt.away_score = 0)
                   or (mt.away_team = pc.team and mt.home_score = 0)))
            then 10 else 0 end
        when 'spice' then case when public.fb_match_winner(rp.selection::bigint) is not null
                 and public.fb_match_winner(rp.selection::bigint) =
                     (select underdog_team from public.matches where id = rp.selection::bigint)
            then 20 else 0 end
        else 0
      end as pts
    from public.round_props rp
    where rp.round_key = p_round_key
  ),
  upd as (
    update public.round_props rp set points_awarded = s.pts
      from scored s where rp.id = s.id returning rp.id
  )
  insert into public.score_events (user_id, source_table, source_id, points, reason)
  select s.user_id, 'round_props', s.id, s.pts, 'prop:' || s.prop from scored s
  on conflict (source_table, source_id)
    do update set points = excluded.points, reason = excluded.reason, created_at = now();

  -- M3: snapshot the post-round standings for rank-change arrows.
  perform public.fb_snapshot_ranks(p_round_key);
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- AUTO-SYNC INGEST (spec §6.2–6.3). The sync-results Edge Function (service role)
-- calls this per match. MANUAL ALWAYS WINS: a manually-finalized match is never
-- overwritten by an API poll. A flip to 'finished' auto-scores with no admin
-- action (and cascades into round-prop settlement via fb_score_match).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.fb_ingest_result(
  p_api_match_id text,
  p_home         int,
  p_away         int,
  p_status       text default 'finished',   -- 'live' | 'finished'
  p_home_et      int  default null,
  p_away_et      int  default null,
  p_winner_code  text default null           -- fifa_code of the knockout winner, optional
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  m        public.matches%rowtype;
  v_winner bigint;
begin
  select * into m from public.matches where api_match_id = p_api_match_id;
  if not found then
    return 'skip: unknown api_match_id';
  end if;
  -- Manual entries are authoritative (spec §6.5) — the API never clobbers them.
  if m.result_source = 'manual' and m.status = 'finished' then
    return 'skip: manual result is authoritative';
  end if;
  if p_status not in ('live', 'finished') then
    raise exception 'FoodBall: fb_ingest_result status must be live|finished' using errcode = 'check_violation';
  end if;

  if p_winner_code is not null then
    select id into v_winner from public.teams where fifa_code = p_winner_code;
  end if;

  update public.matches
     set home_score = p_home, away_score = p_away,
         home_score_et = p_home_et, away_score_et = p_away_et,
         winner = coalesce(v_winner, winner),
         status = p_status, result_source = 'api', updated_at = now()
   where id = m.id;

  if p_status = 'finished' then
    perform public.fb_score_match(m.id);   -- cascades to round-prop settlement
    return 'scored';
  end if;
  return 'updated (live)';
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- REALTIME — publish score_events + matches so the client gets live leaderboard
-- and live-score pushes (spec §7.3). Guarded: the supabase_realtime publication
-- exists on a hosted Supabase project but NOT on the stock-postgres local harness.
-- ════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'score_events') then
      alter publication supabase_realtime add table public.score_events;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
      alter publication supabase_realtime add table public.matches;
    end if;
  end if;
end
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- GRANTS — fb_ingest_result is service-role only (the Edge Function); never
-- client-callable. Snapshot helper is internal.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function public.fb_ingest_result(text, int, int, text, int, int, text) from public;
revoke all on function public.fb_snapshot_ranks(text) from public;
grant execute on function public.fb_ingest_result(text, int, int, text, int, int, text) to service_role;
