-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — Milestone 1 schema, RLS, server-side pick-locking, outcome scoring.
--
-- Authoritative scoring & locking live HERE, in Postgres — never on the client
-- (spec §4.4, §10). This migration is the single source of truth for both the
-- hosted Supabase project and the local Docker proof harness. On Supabase the
-- `auth` schema/`auth.uid()`/roles already exist; the local harness supplies a
-- compatible shim first (docker/db-init/00_auth_shim.sql).
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- TABLES (spec §5)
-- ════════════════════════════════════════════════════════════════════════════

create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  avatar_config jsonb not null default '{}'::jsonb,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.teams (
  id           bigint generated always as identity primary key,
  name         text not null,
  fifa_code    text not null unique,
  fifa_rank    int,
  group_letter text,
  flag_emoji   text
);

create table public.rounds (
  key           text primary key,           -- MD1, MD2, MD3, R32, R16, QF, SF, F
  name          text not null,
  first_kickoff timestamptz,
  completed     boolean not null default false,
  sort_order    int not null
);

create table public.matches (
  id            bigint generated always as identity primary key,
  api_match_id  text unique,
  round_key     text not null references public.rounds(key),
  group_letter  text,
  home_team     bigint not null references public.teams(id),
  away_team     bigint not null references public.teams(id),
  kickoff       timestamptz not null,
  underdog_team bigint references public.teams(id),
  status        text not null default 'scheduled' check (status in ('scheduled','live','finished')),
  home_score    int,
  away_score    int,
  home_score_et int,
  away_score_et int,
  winner        bigint references public.teams(id),
  result_source text check (result_source in ('api','manual')),
  updated_at    timestamptz not null default now(),
  constraint matches_distinct_teams check (home_team <> away_team)
);
create index matches_round_idx   on public.matches(round_key);
create index matches_kickoff_idx on public.matches(kickoff);

create table public.players_catalog (
  id            bigint generated always as identity primary key,
  api_player_id text unique,
  name          text not null,
  team          bigint references public.teams(id),
  position      text
);

create table public.match_picks (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  match_id       bigint not null references public.matches(id) on delete cascade,
  market         text not null check (market in ('outcome','exact_score','btts','over_under')),
  selection      text not null,             -- outcome: 'home'|'draw'|'away'
  created_at     timestamptz not null default now(),
  points_awarded int,
  unique (user_id, match_id, market)
);
create index match_picks_match_idx on public.match_picks(match_id);
create index match_picks_user_idx  on public.match_picks(user_id);

create table public.round_props (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  round_key      text not null references public.rounds(key),
  prop           text not null check (prop in ('top_chef','clean_plate','spice')),
  selection      text not null,
  created_at     timestamptz not null default now(),
  points_awarded int,
  unique (user_id, round_key, prop)
);

create table public.tourney_picks (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  pick_type      text not null check (pick_type in
                   ('champion','finalist','golden_boot','golden_glove','young_player','total_goals')),
  selection      text not null,
  set_after_round text references public.rounds(key),   -- null = pre-tournament
  superseded_by   bigint references public.tourney_picks(id),
  created_at      timestamptz not null default now(),
  points_awarded  int
);

create table public.decay_schedule (
  pick_type       text not null,
  set_after_round text references public.rounds(key),   -- null = pre-tournament
  points          int not null,
  -- NULLS NOT DISTINCT so the single pre-tournament row per pick_type is unique
  -- (a composite PK would wrongly force set_after_round NOT NULL).
  constraint decay_schedule_uq unique nulls not distinct (pick_type, set_after_round)
);

create table public.score_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  source_table text not null,
  source_id    bigint not null,
  points       int not null,
  reason       text,
  created_at   timestamptz not null default now(),
  -- one authoritative event per source row => re-scoring updates, never duplicates
  unique (source_table, source_id)
);
create index score_events_user_idx on public.score_events(user_id);

-- ════════════════════════════════════════════════════════════════════════════
-- LEADERBOARD — "The Food Chain" (spec §7.3)
-- M1 uses a security_invoker VIEW (always consistent). M3 swaps in a
-- materialized view + Realtime + rank_delta vs the previous round.
-- ════════════════════════════════════════════════════════════════════════════
create view public.leaderboard
with (security_invoker = true)
as
  select
    p.id                                                              as user_id,
    p.display_name,
    p.avatar_config,
    coalesce(sum(se.points), 0)::int                                  as total,
    count(*) filter (where se.reason like 'exact:%')::int             as exact_hits,
    count(*) filter (where se.reason like 'outcome:%' and se.points > 0)::int as outcome_hits,
    rank() over (order by coalesce(sum(se.points), 0) desc)::int      as rank,
    0::int                                                            as rank_delta  -- wired in M3
  from public.profiles p
  left join public.score_events se on se.user_id = p.id
  group by p.id, p.display_name, p.avatar_config;

-- ─── Helper: am I an admin? ──────────────────────────────────────────────────
-- SECURITY DEFINER + fixed search_path so RLS policies can call it without
-- recursing through profiles' own RLS. Defined after profiles exists because a
-- LANGUAGE sql body is validated at creation time.
create or replace function public.fb_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════════════════════════════════════════════

-- Auto-provision a profile on first sign-in (display_name editable in onboarding).
create or replace function public.fb_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(coalesce(new.email, 'chef'), '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fb_handle_new_user();

-- Privilege guard: an untrusted request role (authenticated/anon) may flip
-- is_admin ONLY if it is already an admin (so existing admins can promote
-- others). Trusted server roles — service_role / postgres / the DB superuser —
-- bootstrap the first admin. SECURITY INVOKER so current_user is the real
-- caller, not the function owner.
create or replace function public.fb_protect_profile()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if NEW.is_admin is distinct from OLD.is_admin
     and current_user in ('authenticated', 'anon')
     and not public.fb_is_admin() then
    NEW.is_admin := OLD.is_admin;
  end if;
  return NEW;
end;
$$;
create trigger trg_protect_profile
  before update on public.profiles
  for each row execute function public.fb_protect_profile();

-- ★ SERVER-SIDE PICK LOCK (spec §4.4 — the M1 acceptance crux) ★
-- A pick is immutable from the moment its match kicks off. We compare against
-- the kickoff stored in the DB, never the client clock. Enforced for INSERT,
-- for content-changing UPDATEs, and for DELETE. The scorer's points_awarded
-- write (selection/market unchanged) is intentionally allowed through.
create or replace function public.fb_enforce_match_pick_lock()
returns trigger
language plpgsql
as $$
declare
  v_kickoff timestamptz;
  v_match   bigint := coalesce(NEW.match_id, OLD.match_id);
  v_changes_pick boolean :=
       (TG_OP = 'INSERT')
    or (TG_OP = 'DELETE')
    or (NEW.selection is distinct from OLD.selection)
    or (NEW.market    is distinct from OLD.market)
    or (NEW.match_id  is distinct from OLD.match_id);
begin
  -- A pick cannot be moved to a different match: re-picks are delete+insert
  -- (each independently lock-checked). Keeps created_at meaningful as the
  -- placement time of the current (match, selection).
  if TG_OP = 'UPDATE' and NEW.match_id is distinct from OLD.match_id then
    raise exception 'FoodBall: a pick cannot be moved to another match'
      using errcode = 'check_violation';
  end if;

  -- points_awarded is a SERVER-controlled scoring column. Only trusted roles
  -- (the SECURITY DEFINER scorer / service_role / superuser) may change it; an
  -- authenticated/anon request role may never write its own points.
  if TG_OP = 'UPDATE'
     and NEW.points_awarded is distinct from OLD.points_awarded
     and current_user in ('authenticated', 'anon') then
    raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_changes_pick then
    return NEW;            -- system annotation (points_awarded by the scorer) — allowed
  end if;
  select kickoff into v_kickoff from public.matches where id = v_match;
  if v_kickoff is null then
    raise exception 'FoodBall: match % does not exist', v_match using errcode = 'foreign_key_violation';
  end if;
  if now() >= v_kickoff then
    raise exception 'FoodBall: picks for match % are locked — kickoff (%) has passed',
      v_match, v_kickoff using errcode = 'check_violation';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
create trigger trg_match_pick_lock
  before insert or update or delete on public.match_picks
  for each row execute function public.fb_enforce_match_pick_lock();

-- ════════════════════════════════════════════════════════════════════════════
-- SCORING (authoritative) — outcome market only for M1 (spec §4.1, §6.3)
--   Match outcome correct  → 10 pts
--   Upset multiplier       → ×2 when the picked winner is the designated underdog
-- Idempotent: safe to re-run after an admin corrects a result.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.fb_score_match(p_match_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m         public.matches%rowtype;
  v_outcome text;   -- 'home' | 'draw' | 'away'
begin
  select * into m from public.matches where id = p_match_id;
  if not found or m.status <> 'finished' or m.home_score is null or m.away_score is null then
    return;   -- nothing settle-able yet
  end if;

  -- Knockout winner (after ET/pens) is stored explicitly; else derive from score.
  if m.winner is not null then
    v_outcome := case when m.winner = m.home_team then 'home'
                      when m.winner = m.away_team then 'away'
                      else 'draw' end;
  elsif m.home_score > m.away_score then v_outcome := 'home';
  elsif m.home_score < m.away_score then v_outcome := 'away';
  else v_outcome := 'draw';
  end if;

  -- Settle outcome picks: 10 base, doubled if the player picked the underdog and
  -- that underdog won (a draw is not a win, so it never doubles).
  with scored as (
    select mp.id, mp.user_id,
      case when mp.selection = v_outcome then
        10 * case
          when v_outcome <> 'draw'
           and m.underdog_team is not null
           and ((v_outcome = 'home' and m.underdog_team = m.home_team)
             or (v_outcome = 'away' and m.underdog_team = m.away_team))
          then 2 else 1 end
      else 0 end as pts
    from public.match_picks mp
    where mp.match_id = p_match_id and mp.market = 'outcome'
  )
  update public.match_picks mp
     set points_awarded = s.pts
    from scored s
   where mp.id = s.id;

  -- Mirror into the authoritative ledger (idempotent on (source_table, source_id)).
  insert into public.score_events (user_id, source_table, source_id, points, reason)
  select mp.user_id, 'match_picks', mp.id, coalesce(mp.points_awarded, 0),
         'outcome:' || v_outcome
    from public.match_picks mp
   where mp.match_id = p_match_id and mp.market = 'outcome'
  on conflict (source_table, source_id)
    do update set points = excluded.points, reason = excluded.reason, created_at = now();
end;
$$;

-- Admin-only RPC: manual result entry (always wins over the API — spec §6.5).
create or replace function public.fb_admin_set_result(
  p_match_id bigint,
  p_home     int,
  p_away     int,
  p_home_et  int default null,
  p_away_et  int default null,
  p_winner   bigint default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.matches
     set home_score = p_home, away_score = p_away,
         home_score_et = p_home_et, away_score_et = p_away_et,
         winner = p_winner, status = 'finished',
         result_source = 'manual', updated_at = now()
   where id = p_match_id;
  if not found then
    raise exception 'FoodBall: match % does not exist', p_match_id using errcode = 'no_data_found';
  end if;
  perform public.fb_score_match(p_match_id);
end;
$$;

-- Admin-only RPC: designate a match's underdog (the ×2 team).
create or replace function public.fb_admin_set_underdog(p_match_id bigint, p_team_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.matches set underdog_team = p_team_id, updated_at = now() where id = p_match_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (spec §5 — "users read everything after lock, write only
-- their own rows, only before lock; admin bypasses"). FORCE so even the table
-- owner is subject to policy in the local harness.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.profiles        enable row level security;
alter table public.teams           enable row level security;
alter table public.rounds          enable row level security;
alter table public.matches         enable row level security;
alter table public.players_catalog enable row level security;
alter table public.match_picks     enable row level security;
alter table public.round_props     enable row level security;
alter table public.tourney_picks   enable row level security;
alter table public.decay_schedule  enable row level security;
alter table public.score_events    enable row level security;

alter table public.profiles        force row level security;
alter table public.matches         force row level security;
alter table public.match_picks     force row level security;
alter table public.round_props     force row level security;
alter table public.tourney_picks   force row level security;
alter table public.score_events    force row level security;

-- profiles: everyone signed-in reads all; you write only yourself.
create policy profiles_read   on public.profiles for select to authenticated using (true);
-- Mirror the is_admin escalation guard onto the INSERT path (the trigger only
-- covers UPDATE): a self-provisioned profile may not arrive pre-elevated.
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = auth.uid() and is_admin = false);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Reference data: readable by all signed-in users; writable only by admins.
create policy teams_read   on public.teams           for select to authenticated using (true);
create policy teams_admin  on public.teams           for all    to authenticated using (public.fb_is_admin()) with check (public.fb_is_admin());
create policy rounds_read  on public.rounds          for select to authenticated using (true);
create policy rounds_admin on public.rounds          for all    to authenticated using (public.fb_is_admin()) with check (public.fb_is_admin());
create policy match_read   on public.matches         for select to authenticated using (true);
create policy match_admin  on public.matches         for all    to authenticated using (public.fb_is_admin()) with check (public.fb_is_admin());
create policy pcat_read    on public.players_catalog for select to authenticated using (true);
create policy pcat_admin   on public.players_catalog for all    to authenticated using (public.fb_is_admin()) with check (public.fb_is_admin());
create policy decay_read   on public.decay_schedule  for select to authenticated using (true);
create policy decay_admin  on public.decay_schedule  for all    to authenticated using (public.fb_is_admin()) with check (public.fb_is_admin());

-- match_picks: own picks always visible; everyone else's only AFTER kickoff
-- (anti-copying, spec §5). Writes are own-only; the lock TRIGGER enforces timing.
create policy match_picks_read on public.match_picks for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.matches m where m.id = match_id and now() >= m.kickoff)
    or public.fb_is_admin()
  );
create policy match_picks_insert on public.match_picks for insert to authenticated
  with check (user_id = auth.uid());
create policy match_picks_update on public.match_picks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy match_picks_delete on public.match_picks for delete to authenticated
  using (user_id = auth.uid());

-- round_props / tourney_picks: owner-scoped for M1 (cross-visibility rules land
-- in M2 alongside the prop/decay locking windows).
create policy round_props_own  on public.round_props  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tourney_own       on public.tourney_picks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- score_events: read-all (the leaderboard is social); writes only via the
-- SECURITY DEFINER scorer / service role — no client write policy exists.
create policy score_events_read on public.score_events for select to authenticated using (true);

-- ════════════════════════════════════════════════════════════════════════════
-- GRANTS — least privilege. Reference scoring fns are NOT client-callable;
-- the admin RPCs are (they self-check fb_is_admin()).
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function public.fb_score_match(bigint)                    from public;
revoke all on function public.fb_admin_set_result(bigint,int,int,int,int,bigint) from public;
revoke all on function public.fb_admin_set_underdog(bigint,bigint)      from public;
grant execute on function public.fb_admin_set_result(bigint,int,int,int,int,bigint) to authenticated;
grant execute on function public.fb_admin_set_underdog(bigint,bigint)   to authenticated;
grant execute on function public.fb_is_admin()                          to authenticated;
