-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — Milestone 2: full per-match markets, per-round props, tournament-
-- long picks with decay + server-enforced revision windows + revision history.
--
-- Authoritative scoring & locking continue to live HERE, in Postgres (spec §4,
-- §6, §10). This migration is additive to 0001_init.sql and is applied right
-- after it (local harness: mounted as 01b_m2.sql, before 02_grants). On a hosted
-- Supabase project it is simply the next migration.
--
-- M2 acceptance crux (spec §9): a tournament-pick revision attempted OUTSIDE an
-- open window is rejected SERVER-SIDE even if the client UI / REST call is forged
-- — enforced by the fb_enforce_tourney_pick trigger, not the client clock.
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- NEW REFERENCE TABLES (admin-entered facts the free results API doesn't expose)
-- ════════════════════════════════════════════════════════════════════════════

-- Per-round top scorer(s) — drives the "Top Chef" prop. The free API does not
-- reliably expose goal-scorer data, so the admin enters it (spec §6.4 applies the
-- same reasoning to golden boot/glove). Ties: every listed player is a winner.
create table public.round_top_scorers (
  round_key text   not null references public.rounds(key),
  player_id bigint not null references public.players_catalog(id),
  primary key (round_key, player_id)
);

-- Tournament outcomes the admin enters to settle tournament-long picks. One row
-- per correct answer: champion=1 row, finalist=2 rows, golden_*/young_player=1
-- row (player id), total_goals=1 row (the actual total, as text). Picks match
-- against these (finalist matches EITHER row; total_goals within ±5).
create table public.tournament_results (
  pick_type text not null,
  selection text not null,
  primary key (pick_type, selection)
);

-- Keep exactly one active tournament pick per (user, type) honest at the schema
-- level is impossible with the supersede chain (transient two-active windows), so
-- "active = latest by (created_at, id)" is enforced in the scorer instead. This
-- index just speeds the revision-history lookups.
create index tourney_picks_active_idx
  on public.tourney_picks (user_id, pick_type, created_at desc, id desc);

-- ════════════════════════════════════════════════════════════════════════════
-- DECAY HELPERS — the Postgres mirror of src/lib/decay.ts. Both read the
-- decay_schedule table so the two never drift (spec §4.3, CLAUDE.md "The Menu").
-- ════════════════════════════════════════════════════════════════════════════

-- Latest *completed* round, by sort_order (null if none completed yet).
create or replace function public.fb_latest_completed_round()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select key from public.rounds
   where completed order by sort_order desc limit 1;
$$;

-- Map a round key to its decay bucket. Group-stage rounds collapse to 'MD3'
-- ("After MD1–MD3" is one column in §4.3); the final pays no more than "After SF".
create or replace function public.fb_decay_bucket(p_round text)
returns text
language sql
immutable
as $$
  select case p_round
    when 'MD1' then 'MD3' when 'MD2' then 'MD3' when 'MD3' then 'MD3'
    when 'R32' then 'R32' when 'R16' then 'R16'
    when 'QF'  then 'QF'  when 'SF'  then 'SF'  when 'F' then 'SF'
    else null end;
$$;

-- Points a pick of p_pick_type is worth if it was last set after p_set_after_round
-- (a raw round key OR an already-bucketed value). 0 for the "—" cells of §4.3.
create or replace function public.fb_decay_points(p_pick_type text, p_set_after_round text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select ds.points from public.decay_schedule ds
     where ds.pick_type = p_pick_type
       and ds.set_after_round is not distinct from public.fb_decay_bucket(p_set_after_round)
  ), 0);
$$;

-- The tournament-pick revision window is OPEN iff no round is currently in
-- progress — i.e. there is no round whose first kickoff has passed but which is
-- not yet completed. That is exactly "pre-tournament, or between a round
-- completing and the next round's first kickoff" (spec §4.4).
create or replace function public.fb_tourney_revision_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.rounds
     where first_kickoff is not null and now() >= first_kickoff and not completed
  );
$$;

-- Winning team of a finished match (null = draw / not finished). Knockout winner
-- is stored explicitly; group winner derived from the regulation score.
create or replace function public.fb_match_winner(p_match_id bigint)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.status <> 'finished' or m.home_score is null or m.away_score is null then null
    when m.winner is not null then m.winner
    when m.home_score > m.away_score then m.home_team
    when m.away_score > m.home_score then m.away_team
    else null end
  from public.matches m where m.id = p_match_id;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- LEADERBOARD — fix exact_hits to count only SCORED exact hits (points > 0).
-- (M1's view counted every exact score_event; M2 writes a 0-point event for a
-- missed exact pick too, so the filter must require points > 0. Same shape/cols.)
-- ════════════════════════════════════════════════════════════════════════════
create or replace view public.leaderboard
with (security_invoker = true)
as
  select
    p.id                                                              as user_id,
    p.display_name,
    p.avatar_config,
    coalesce(sum(se.points), 0)::int                                  as total,
    count(*) filter (where se.reason like 'exact:%'   and se.points > 0)::int as exact_hits,
    count(*) filter (where se.reason like 'outcome:%' and se.points > 0)::int as outcome_hits,
    rank() over (order by coalesce(sum(se.points), 0) desc)::int      as rank,
    0::int                                                            as rank_delta  -- wired in M3
  from public.profiles p
  left join public.score_events se on se.user_id = p.id
  group by p.id, p.display_name, p.avatar_config;

-- ════════════════════════════════════════════════════════════════════════════
-- SCORING — per-match, all markets (spec §4.1). Idempotent on (source_table,
-- source_id). Replaces the M1 outcome-only version and adds the round-complete
-- cascade into round-prop settlement.
--   outcome     10  (×2 if the picked winner is the designated underdog)
--   exact_score +25 (regulation score for groups; after-ET for knockouts)
--   btts          5 (both teams scored in regulation)
--   over_under    5 (total regulation goals over/under 2.5)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.fb_score_match(p_match_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m          public.matches%rowtype;
  v_outcome  text;
  v_exact    text;
  v_btts     text;
  v_ou       text;
  v_upset    boolean;
  v_all_done boolean;
begin
  select * into m from public.matches where id = p_match_id;
  if not found or m.status <> 'finished' or m.home_score is null or m.away_score is null then
    return;   -- nothing settle-able yet
  end if;

  if m.winner is not null then
    v_outcome := case when m.winner = m.home_team then 'home'
                      when m.winner = m.away_team then 'away' else 'draw' end;
  elsif m.home_score > m.away_score then v_outcome := 'home';
  elsif m.home_score < m.away_score then v_outcome := 'away';
  else v_outcome := 'draw';
  end if;

  -- Exact score: regulation for groups; after-ET (pens excluded) for knockouts.
  v_exact := coalesce(m.home_score_et, m.home_score)::text || '-' ||
             coalesce(m.away_score_et, m.away_score)::text;
  -- BTTS / over-under settle on the REGULATION (90-min) score by convention —
  -- these are standard 90-min markets, unlike exact score which counts ET goals.
  v_btts  := case when m.home_score > 0 and m.away_score > 0 then 'yes' else 'no' end;
  v_ou    := case when (m.home_score + m.away_score) >= 3 then 'over' else 'under' end;
  v_upset := v_outcome <> 'draw'
         and m.underdog_team is not null
         and ((v_outcome = 'home' and m.underdog_team = m.home_team)
           or (v_outcome = 'away' and m.underdog_team = m.away_team));

  with scored as (
    select mp.id, mp.user_id, mp.market,
      case mp.market
        when 'outcome'     then case when mp.selection = v_outcome
                                     then 10 * (case when v_upset then 2 else 1 end) else 0 end
        when 'exact_score' then case when mp.selection = v_exact then 25 else 0 end
        when 'btts'        then case when mp.selection = v_btts  then 5  else 0 end
        when 'over_under'  then case when mp.selection = v_ou    then 5  else 0 end
        else 0
      end as pts,
      case mp.market
        when 'outcome'     then 'outcome:' || v_outcome
        when 'exact_score' then 'exact:'   || mp.selection   -- leaderboard.exact_hits keys off 'exact:%'
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

  -- Round-complete cascade: when the LAST match of the round finishes, mark the
  -- round complete (opens the tournament revision window) and settle its props.
  select bool_and(status = 'finished') into v_all_done
    from public.matches where round_key = m.round_key;
  if coalesce(v_all_done, false) then
    update public.rounds set completed = true where key = m.round_key and not completed;
    perform public.fb_score_round(m.round_key);
  end if;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SCORING — per-round props (spec §4.2). Idempotent. clean_plate & spice are
-- derived from match data; top_chef matches the admin-entered round top scorers.
--   Top Chef     15  selection = player_id of the round's top scorer (ties: all win)
--   Clean Plate  10  selection = goalkeeper player_id; team kept a clean sheet
--   Spice        20  selection = match_id where the designated underdog won
-- ════════════════════════════════════════════════════════════════════════════
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
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- SCORING — tournament-long picks with decay (spec §4.3). Settles only the
-- ACTIVE pick (latest by created_at,id) per (user, pick_type), and only for
-- pick_types whose actual result the admin has entered. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.fb_score_tournament()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  with active as (
    select distinct on (tp.user_id, tp.pick_type)
           tp.id, tp.user_id, tp.pick_type, tp.selection, tp.set_after_round
      from public.tourney_picks tp
     order by tp.user_id, tp.pick_type, tp.created_at desc, tp.id desc
  ),
  scored as (
    select a.id, a.user_id, a.pick_type,
      case
        when not exists (select 1 from public.tournament_results r where r.pick_type = a.pick_type)
          then null::int                       -- actual not entered yet → leave unsettled
        when a.pick_type = 'total_goals' then
          case when exists (
                 select 1 from public.tournament_results r
                  where r.pick_type = 'total_goals'
                    and abs(r.selection::int - a.selection::int) <= 5)
               then public.fb_decay_points(a.pick_type, a.set_after_round) else 0 end
        else
          case when exists (
                 select 1 from public.tournament_results r
                  where r.pick_type = a.pick_type and r.selection = a.selection)
               then public.fb_decay_points(a.pick_type, a.set_after_round) else 0 end
      end as pts
    from active a
  ),
  upd as (
    update public.tourney_picks tp set points_awarded = s.pts
      from scored s where tp.id = s.id and s.pts is not null returning tp.id
  )
  insert into public.score_events (user_id, source_table, source_id, points, reason)
  select s.user_id, 'tourney_picks', s.id, s.pts, 'tourney:' || s.pick_type
    from scored s where s.pts is not null
  on conflict (source_table, source_id)
    do update set points = excluded.points, reason = excluded.reason, created_at = now();
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- TOURNAMENT-PICK REVISION WINDOW + ANTI-CHEAT (the M2 acceptance crux).
-- For untrusted request roles (authenticated/anon):
--   • INSERT only while the revision window is open; the server STAMPS
--     set_after_round (the decay bucket) so a client can't forge a higher-value
--     earlier bucket, and forbids pre-awarded points.
--   • content (pick_type/selection/set_after_round) is immutable in place — a
--     revision is a NEW pick, not an edit (only superseded_by may change).
--   • points_awarded is server-controlled; DELETE is forbidden (history is kept).
-- Trusted roles (the SECURITY DEFINER scorer / service_role / postgres) bypass.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.fb_enforce_tourney_pick()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return case when TG_OP = 'DELETE' then OLD else NEW end;  -- trusted server path
  end if;

  if TG_OP = 'DELETE' then
    raise exception 'FoodBall: tournament picks cannot be deleted — they are revised, never removed'
      using errcode = 'check_violation';
  end if;

  if TG_OP = 'INSERT' then
    if not public.fb_tourney_revision_open() then
      raise exception 'FoodBall: the tournament-pick revision window is closed (a round is in progress)'
        using errcode = 'check_violation';
    end if;
    NEW.set_after_round := public.fb_decay_bucket(public.fb_latest_completed_round());
    NEW.points_awarded  := null;   -- server-scored only
    NEW.superseded_by   := null;   -- a fresh pick is active
    return NEW;
  end if;

  -- UPDATE by an untrusted role
  if NEW.points_awarded is distinct from OLD.points_awarded then
    raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
      using errcode = 'insufficient_privilege';
  end if;
  if NEW.pick_type      is distinct from OLD.pick_type
     or NEW.selection       is distinct from OLD.selection
     or NEW.set_after_round is distinct from OLD.set_after_round then
    raise exception 'FoodBall: revise a tournament pick by setting a NEW pick, not editing this one'
      using errcode = 'check_violation';
  end if;
  return NEW;   -- only superseded_by may change (the supersede link)
end;
$$;
create trigger trg_tourney_pick_window
  before insert or update or delete on public.tourney_picks
  for each row execute function public.fb_enforce_tourney_pick();

-- ════════════════════════════════════════════════════════════════════════════
-- ROUND-PROP LOCK — props lock at the round's first kickoff (spec §4.2). Same
-- shape as the match-pick lock: content is frozen at lock, points_awarded is
-- server-only, the scorer's annotation passes through.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.fb_enforce_round_prop_lock()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_lock    timestamptz;
  v_round   text := coalesce(NEW.round_key, OLD.round_key);
  v_changes boolean :=
       (TG_OP = 'INSERT') or (TG_OP = 'DELETE')
    or (NEW.selection is distinct from OLD.selection)
    or (NEW.prop      is distinct from OLD.prop)
    or (NEW.round_key is distinct from OLD.round_key);
begin
  if TG_OP = 'UPDATE'
     and NEW.points_awarded is distinct from OLD.points_awarded
     and current_user in ('authenticated', 'anon') then
    raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
      using errcode = 'insufficient_privilege';
  end if;
  if not v_changes then
    return NEW;   -- scorer annotation — allowed
  end if;
  select first_kickoff into v_lock from public.rounds where key = v_round;
  if v_lock is not null and now() >= v_lock then
    raise exception 'FoodBall: round-prop picks for % are locked — the round has started (%)',
      v_round, v_lock using errcode = 'check_violation';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
create trigger trg_round_prop_lock
  before insert or update or delete on public.round_props
  for each row execute function public.fb_enforce_round_prop_lock();

-- ════════════════════════════════════════════════════════════════════════════
-- CLIENT RPCs
-- ════════════════════════════════════════════════════════════════════════════

-- Set (or revise) a tournament-long pick. SECURITY INVOKER: runs as the calling
-- user, so the trigger above enforces the window + stamps the bucket. Supersedes
-- the user's prior active pick of this type so the revision history reads cleanly
-- (scoring uses "latest active", so this link is for display, not authority).
create or replace function public.fb_set_tourney_pick(p_pick_type text, p_selection text)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_new bigint;
begin
  if v_uid is null then
    raise exception 'FoodBall: sign in to set a pick' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_selection), '') = '' then
    raise exception 'FoodBall: a pick needs a selection' using errcode = 'check_violation';
  end if;
  -- set_after_round is stamped by the trigger; we pass null.
  insert into public.tourney_picks (user_id, pick_type, selection, set_after_round)
  values (v_uid, p_pick_type, p_selection, null)
  returning id into v_new;
  update public.tourney_picks
     set superseded_by = v_new
   where user_id = v_uid and pick_type = p_pick_type and id <> v_new and superseded_by is null;
  return v_new;
end;
$$;

-- Admin: enter the round's top scorer(s) and (re)settle the round's props.
-- Optionally mark the round complete (spec §7.6 round-complete override).
create or replace function public.fb_admin_settle_round(
  p_round_key      text,
  p_top_scorer_ids bigint[] default '{}',
  p_mark_complete  boolean  default true
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  delete from public.round_top_scorers where round_key = p_round_key;
  if array_length(p_top_scorer_ids, 1) is not null then
    insert into public.round_top_scorers (round_key, player_id)
    select p_round_key, unnest(p_top_scorer_ids)
    on conflict do nothing;
  end if;
  if p_mark_complete then
    update public.rounds set completed = true where key = p_round_key;
  end if;
  perform public.fb_score_round(p_round_key);
end;
$$;

-- Admin: enter a tournament outcome and settle the matching picks. For finalists,
-- call twice (once per finalist). p_selection is a team id / player id / number,
-- as text. Replaces prior rows for single-answer types; finalist accumulates.
create or replace function public.fb_admin_set_tournament_result(p_pick_type text, p_selection text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_pick_type <> 'finalist' then
    delete from public.tournament_results where pick_type = p_pick_type;
  end if;
  insert into public.tournament_results (pick_type, selection)
  values (p_pick_type, p_selection) on conflict do nothing;
  perform public.fb_score_tournament();
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- RLS — M2 visibility. Reference tables readable by all; the social-visibility
-- rule (own picks always, others' only after lock) now extends to round_props
-- and tourney_picks. Writes stay own-only; the lock/window TRIGGERS enforce time.
-- ════════════════════════════════════════════════════════════════════════════
alter table public.round_top_scorers  enable row level security;
alter table public.tournament_results enable row level security;
create policy rts_read   on public.round_top_scorers  for select to authenticated using (true);
create policy tres_read  on public.tournament_results for select to authenticated using (true);

-- round_props: replace the M1 owner-only policy with read-after-lock visibility.
drop policy if exists round_props_own on public.round_props;
create policy round_props_read on public.round_props for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.rounds r where r.key = round_key
                 and r.first_kickoff is not null and now() >= r.first_kickoff)
    or public.fb_is_admin()
  );
create policy round_props_insert on public.round_props for insert to authenticated
  with check (user_id = auth.uid());
create policy round_props_update on public.round_props for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy round_props_delete on public.round_props for delete to authenticated
  using (user_id = auth.uid());

-- tourney_picks: own picks always; everyone else's once the tournament is under
-- way (MD1 has kicked off). Writes own-only; the window TRIGGER enforces timing.
drop policy if exists tourney_own on public.tourney_picks;
create policy tourney_read on public.tourney_picks for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.rounds r where r.key = 'MD1'
                 and r.first_kickoff is not null and now() >= r.first_kickoff)
    or public.fb_is_admin()
  );
create policy tourney_insert on public.tourney_picks for insert to authenticated
  with check (user_id = auth.uid());
create policy tourney_update on public.tourney_picks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ════════════════════════════════════════════════════════════════════════════
-- GRANTS — new client-callable RPCs (each self-checks admin where needed). The
-- scoring fns + helpers are NOT client-callable.
-- ════════════════════════════════════════════════════════════════════════════
revoke all on function public.fb_score_round(text)                       from public;
revoke all on function public.fb_score_tournament()                      from public;
revoke all on function public.fb_admin_settle_round(text, bigint[], boolean) from public;
revoke all on function public.fb_admin_set_tournament_result(text, text)  from public;
grant execute on function public.fb_set_tourney_pick(text, text)          to authenticated;
grant execute on function public.fb_admin_settle_round(text, bigint[], boolean) to authenticated;
grant execute on function public.fb_admin_set_tournament_result(text, text) to authenticated;
grant execute on function public.fb_tourney_revision_open()               to authenticated;
grant execute on function public.fb_decay_points(text, text)              to authenticated;
grant execute on function public.fb_latest_completed_round()              to authenticated;
