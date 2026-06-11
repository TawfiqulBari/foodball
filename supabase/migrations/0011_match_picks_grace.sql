-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — LATE-START GRACE for per-match markets (Win/Draw/Win, exact score,
-- BTTS, over/under). These lock at each match's kickoff. Because the league
-- launched after MD1 had already started, today's live/upcoming matches were
-- unpickable. This grace keeps match markets open past kickoff during the launch
-- window — but ONLY for matches that are still playable (scheduled/live); a
-- FINISHED match is never pickable (its result is known — that would be unfair).
--
-- Enforced in the same server-side trigger that already locks match picks. The
-- third and most fairness-sensitive of the launch graces, so it is the tightest:
-- finished matches stay hard-locked even while grace is on.
--
-- Idempotent. No change to existing picks; only the kickoff lock is relaxed for
-- non-finished matches while grace is active. Mirrors 0007 (long shots) / 0008
-- (round specials). Builds on 0009 (cascade pick cleanup) — keeps that behaviour.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.settings add column if not exists match_picks_grace_until timestamptz;

-- Open by default for the launch — only if unset, so re-runs never clobber an
-- admin-tuned value. Until 2026-06-14 23:59 Asia/Dhaka (UTC+6), same as the others.
update public.settings
   set match_picks_grace_until = timestamptz '2026-06-14 23:59:00+06'
 where id and match_picks_grace_until is null;

create or replace function public.fb_match_picks_grace_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select match_picks_grace_until from public.settings where id) > now(), false);
$$;

-- Re-define the match-pick lock to allow picks on a still-playable match while
-- grace is active. Preserves every prior guard: the move-match block, the
-- server-only points_awarded write, the scorer-annotation fast path, and the
-- 0009 cascade-cleanup (a DELETE whose parent match is already gone is allowed).
-- NOT security definer / no search_path reset — `current_user` must stay the
-- caller so the points_awarded guard still distinguishes authenticated/anon.
create or replace function public.fb_enforce_match_pick_lock()
returns trigger
language plpgsql
as $$
declare
  v_kickoff timestamptz;
  v_status  text;
  v_match   bigint := coalesce(NEW.match_id, OLD.match_id);
  v_changes_pick boolean :=
       (TG_OP = 'INSERT')
    or (TG_OP = 'DELETE')
    or (NEW.selection is distinct from OLD.selection)
    or (NEW.market    is distinct from OLD.market)
    or (NEW.match_id  is distinct from OLD.match_id);
begin
  if TG_OP = 'UPDATE' and NEW.match_id is distinct from OLD.match_id then
    raise exception 'FoodBall: a pick cannot be moved to another match'
      using errcode = 'check_violation';
  end if;

  if TG_OP = 'UPDATE'
     and NEW.points_awarded is distinct from OLD.points_awarded
     and current_user in ('authenticated', 'anon') then
    raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
      using errcode = 'insufficient_privilege';
  end if;

  if not v_changes_pick then
    return NEW;            -- system annotation (points_awarded by the scorer) — allowed
  end if;

  select kickoff, status into v_kickoff, v_status from public.matches where id = v_match;
  if v_kickoff is null then
    -- Parent match gone (cascade teardown) — nothing left to lock (0009).
    if TG_OP = 'DELETE' then return OLD; end if;
    raise exception 'FoodBall: match % does not exist', v_match using errcode = 'foreign_key_violation';
  end if;

  if now() >= v_kickoff then
    -- Past kickoff. A finished match is never pickable. Otherwise the launch
    -- grace (if active) keeps a still-playable match open; without grace it locks.
    if v_status = 'finished' then
      raise exception 'FoodBall: picks for match % are locked — it has finished', v_match
        using errcode = 'check_violation';
    elsif not public.fb_match_picks_grace_active() then
      raise exception 'FoodBall: picks for match % are locked — kickoff (%) has passed',
        v_match, v_kickoff using errcode = 'check_violation';
    end if;
    -- else: grace active and match not finished → allowed (fall through).
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- Admin: set / clear the match-pick grace (pass NULL to clear).
create or replace function public.fb_admin_set_match_picks_grace(p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  insert into public.settings (id, match_picks_grace_until) values (true, p_until)
  on conflict (id) do update set match_picks_grace_until = excluded.match_picks_grace_until;
end;
$$;

revoke all on function public.fb_admin_set_match_picks_grace(timestamptz) from public;
grant execute on function public.fb_admin_set_match_picks_grace(timestamptz) to authenticated;
grant execute on function public.fb_match_picks_grace_active()             to authenticated;
