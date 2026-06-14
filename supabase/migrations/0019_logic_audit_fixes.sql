-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — logic-audit remediation (2026-06-14). Fixes the DB-side findings of
-- docs/logic-audit-2026-06-14.md. Idempotent: CREATE OR REPLACE + guarded ALTERs.
-- Each function is re-defined from its current live source with the fix applied;
-- SECURITY DEFINER / search_path / non-definer trigger semantics are preserved.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── #1 / #17  cast-safety constraints (data verified clean before adding) ────
-- Only the columns the scorers actually CAST need to be numeric; bound total_goals.
alter table public.round_props        drop constraint if exists round_props_spice_numeric;
alter table public.round_props        add  constraint round_props_spice_numeric
  check (prop <> 'spice' or selection ~ '^[0-9]+$');
alter table public.tourney_picks      drop constraint if exists tourney_total_goals_num;
alter table public.tourney_picks      add  constraint tourney_total_goals_num
  check (pick_type <> 'total_goals' or selection ~ '^[0-9]{1,4}$');
alter table public.tournament_results drop constraint if exists tres_total_goals_num;
alter table public.tournament_results add  constraint tres_total_goals_num
  check (pick_type <> 'total_goals' or selection ~ '^[0-9]{1,4}$');

-- ─── #20  red_cards idempotency (no duplicate card per user/match/market) ─────
alter table public.red_cards drop constraint if exists red_cards_uq;
alter table public.red_cards add  constraint red_cards_uq unique (user_id, match_id, market);

-- ─── #8  delete a pick → delete its ledger points (no orphan/phantom total) ───
create or replace function public.fb_cleanup_score_events()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.score_events
   where source_table = TG_TABLE_NAME and source_id = OLD.id;
  return OLD;
end; $$;
drop trigger if exists trg_cleanup_se_match_picks on public.match_picks;
drop trigger if exists trg_cleanup_se_round_props on public.round_props;
drop trigger if exists trg_cleanup_se_tourney    on public.tourney_picks;
create trigger trg_cleanup_se_match_picks after delete on public.match_picks
  for each row execute function public.fb_cleanup_score_events();
create trigger trg_cleanup_se_round_props after delete on public.round_props
  for each row execute function public.fb_cleanup_score_events();
create trigger trg_cleanup_se_tourney    after delete on public.tourney_picks
  for each row execute function public.fb_cleanup_score_events();

-- ─── #2 / #3  tournament anti-cheat: created_at is server-controlled ──────────
-- created_at can no longer be forged to re-activate an old pick outside the window.
create or replace function public.fb_enforce_tourney_pick()
returns trigger language plpgsql set search_path = public as $$
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
    NEW.set_after_round := case
      when public.fb_longshot_grace_active() then null
      else public.fb_decay_bucket(public.fb_latest_completed_round())
    end;
    NEW.points_awarded := null;   -- server-scored only
    NEW.superseded_by  := null;   -- a fresh pick is active
    NEW.created_at     := now();  -- ★ server-stamped: cannot be forged to re-activate later
    return NEW;
  end if;

  -- UPDATE by an untrusted role
  if NEW.points_awarded is distinct from OLD.points_awarded then
    raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
      using errcode = 'insufficient_privilege';
  end if;
  if NEW.created_at is distinct from OLD.created_at then
    raise exception 'FoodBall: created_at is immutable (anti-cheat)' using errcode = 'check_violation';
  end if;
  if NEW.pick_type      is distinct from OLD.pick_type
     or NEW.selection       is distinct from OLD.selection
     or NEW.set_after_round is distinct from OLD.set_after_round then
    raise exception 'FoodBall: revise a tournament pick by setting a NEW pick, not editing this one'
      using errcode = 'check_violation';
  end if;
  return NEW;
end; $$;

-- ─── #2 / #3 / #1  scorer: active pick by IMMUTABLE id; cast-safe total_goals ─
create or replace function public.fb_score_tournament()
returns void language plpgsql security definer set search_path = public as $$
begin
  with active as (
    select distinct on (tp.user_id, tp.pick_type)
           tp.id, tp.user_id, tp.pick_type, tp.selection, tp.set_after_round
      from public.tourney_picks tp
     order by tp.user_id, tp.pick_type, tp.id desc   -- id is generated-always: not client-writable
  ),
  scored as (
    select a.id, a.user_id, a.pick_type,
      case
        when not exists (select 1 from public.tournament_results r where r.pick_type = a.pick_type)
          then null::int
        when a.pick_type = 'total_goals' then
          case when a.selection ~ '^[0-9]+$' and exists (
                 select 1 from public.tournament_results r
                  where r.pick_type = 'total_goals' and r.selection ~ '^[0-9]+$'
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
end; $$;

-- ─── #1 / #23  round scorer: cast-safe spice; clean_plate must be a keeper ────
create or replace function public.fb_score_round(p_round_key text)
returns void language plpgsql security definer set search_path = public as $$
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
                 and pc.position = 'GK'                       -- ★ must be a goalkeeper
                 and ((mt.home_team = pc.team and mt.away_score = 0)
                   or (mt.away_team = pc.team and mt.home_score = 0)))
            then 10 else 0 end
        when 'spice' then case
            when rp.selection ~ '^[0-9]+$'                    -- ★ cast-safe
                 and public.fb_match_winner(rp.selection::bigint) is not null
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

  perform public.fb_snapshot_ranks(p_round_key);
end; $$;

-- ─── #9  revision window: empty / all-finished rounds don't block it forever ─
create or replace function public.fb_tourney_revision_open()
returns boolean language sql stable security definer set search_path = public as $$
  select public.fb_longshot_grace_active()
      or not exists (
           select 1 from public.rounds r
            where r.first_kickoff is not null and now() >= r.first_kickoff and not r.completed
              and exists (select 1 from public.matches m
                           where m.round_key = r.key and m.status <> 'finished')
         );
$$;

-- ─── #6  round-completion is self-correcting (not a one-way latch) ────────────
create or replace function public.fb_score_match(p_match_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  m          public.matches%rowtype;
  v_outcome  text; v_exact text; v_btts text; v_ou text;
  v_upset    boolean; v_all_done boolean;
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

  -- Self-correcting completion: completed tracks the CURRENT all-finished state,
  -- so a corrected/late result can flip it back (no permanent latch).
  select bool_and(status = 'finished') into v_all_done
    from public.matches where round_key = m.round_key;
  update public.rounds set completed = coalesce(v_all_done, false)
   where key = m.round_key and completed is distinct from coalesce(v_all_done, false);
  if coalesce(v_all_done, false) then
    perform public.fb_score_round(m.round_key);
  end if;
end; $$;

-- ─── #13  ingest never reverts a finished match (live poll can't un-finish) ───
create or replace function public.fb_ingest_result(p_api_match_id text, p_home integer, p_away integer,
  p_status text default 'finished', p_home_et integer default null, p_away_et integer default null,
  p_winner_code text default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.matches%rowtype; v_winner bigint;
begin
  select * into m from public.matches where api_match_id = p_api_match_id;
  if not found then return 'skip: unknown api_match_id'; end if;
  if m.result_source = 'manual' and m.status = 'finished' then
    return 'skip: manual result is authoritative';
  end if;
  -- ★ Never regress a finished match (a late 'live' poll must not un-finish it).
  if m.status = 'finished' and p_status <> 'finished' then
    return 'skip: match already finished';
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
    perform public.fb_score_match(m.id);
    return 'scored';
  end if;
  return 'updated (live)';
end; $$;

-- ─── #18  settle-round only marks complete when the round is actually done ────
create or replace function public.fb_admin_settle_round(p_round_key text,
  p_top_scorer_ids bigint[] default '{}', p_mark_complete boolean default true)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  delete from public.round_top_scorers where round_key = p_round_key;
  if array_length(p_top_scorer_ids, 1) is not null then
    insert into public.round_top_scorers (round_key, player_id)
    select p_round_key, unnest(p_top_scorer_ids) on conflict do nothing;
  end if;
  -- Only mark complete when every match in the round has actually finished.
  if p_mark_complete and not exists (
       select 1 from public.matches where round_key = p_round_key and status <> 'finished') then
    update public.rounds set completed = true where key = p_round_key;
  end if;
  perform public.fb_score_round(p_round_key);
end; $$;

-- ─── #7  a wrong tournament result (esp. finalist) can be corrected ──────────
create or replace function public.fb_admin_remove_tournament_result(p_pick_type text, p_selection text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  delete from public.tournament_results where pick_type = p_pick_type and selection = p_selection;
  -- Fully revert prior settlement for this type, then re-score from what remains.
  update public.tourney_picks set points_awarded = null where pick_type = p_pick_type;
  delete from public.score_events
   where source_table = 'tourney_picks' and reason = 'tourney:' || p_pick_type;
  perform public.fb_score_tournament();
end; $$;

-- ─── #6  admin can manually fix a round's completed flag ──────────────────────
create or replace function public.fb_admin_set_round_complete(p_round_key text, p_complete boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  update public.rounds set completed = p_complete where key = p_round_key;
end; $$;

-- ─── #16  signup allowlist fails CLOSED when empty (seeded non-empty) ─────────
-- ─── #25  also enforced on email change, not just signup ─────────────────────
create or replace function public.fb_enforce_signup_domain()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_domain text;
begin
  if TG_OP = 'UPDATE' and NEW.email is not distinct from OLD.email then
    return NEW;  -- email unchanged on an update → nothing to check
  end if;
  if not exists (select 1 from public.signup_allowed_domains) then
    raise exception 'FoodBall: sign-ups are closed — no approved email domains configured'
      using errcode = 'check_violation';                       -- ★ fail-closed
  end if;
  v_domain := lower(split_part(coalesce(NEW.email, ''), '@', 2));
  if v_domain = '' then
    raise exception 'FoodBall: a valid email is required to sign up' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.signup_allowed_domains where lower(domain) = v_domain) then
    raise exception 'FoodBall: sign-ups are limited to approved email domains'
      using errcode = 'check_violation';
  end if;
  return NEW;
end; $$;
drop trigger if exists trg_enforce_signup_domain on auth.users;
create trigger trg_enforce_signup_domain
  before insert or update of email on auth.users
  for each row execute function public.fb_enforce_signup_domain();

-- ─── #4 / #5 / #15  RLS: a pick is readable by others ONLY while it is locked ─
-- tourney picks: revisable all tournament → only reveal others' once the revision
-- window is CLOSED (a round in progress, no grace) OR results have been settled.
alter policy tourney_read on public.tourney_picks using (
  user_id = auth.uid()
  or public.fb_is_admin()
  or not public.fb_tourney_revision_open()
  or exists (select 1 from public.tournament_results)
);
-- round props: reveal others' only once past first kickoff AND grace is off
-- (grace keeps them writable, so they must stay private during it).
alter policy round_props_read on public.round_props using (
  user_id = auth.uid()
  or public.fb_is_admin()
  or exists (select 1 from public.rounds r
              where r.key = round_props.round_key and r.first_kickoff is not null
                and now() >= r.first_kickoff and not public.fb_round_props_grace_active())
);

-- ─── #19  admins may update other profiles (is_admin still trigger-guarded) ───
alter policy profiles_update on public.profiles
  using (id = auth.uid() or public.fb_is_admin())
  with check (id = auth.uid() or public.fb_is_admin());

-- ─── grants for the new admin RPCs (admin-gated inside) ───────────────────────
revoke all on function public.fb_admin_remove_tournament_result(text, text) from public;
revoke all on function public.fb_admin_set_round_complete(text, boolean)     from public;
grant execute on function public.fb_admin_remove_tournament_result(text, text) to authenticated;
grant execute on function public.fb_admin_set_round_complete(text, boolean)     to authenticated;
