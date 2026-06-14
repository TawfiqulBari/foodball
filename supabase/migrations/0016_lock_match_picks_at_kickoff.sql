-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — STRICT match-pick locking at kickoff (supersedes the 0011 launch
-- grace for per-match markets).
--
-- The launch grace (0011) kept per-match markets open PAST kickoff for any still-
-- playable (scheduled/live) match while a grace window was active. That window was
-- only meant for the mid-round launch, but it left started matches editable — a
-- player could set or change a prediction after a match had already kicked off
-- (and, for a live match, after seeing how it was going). That is unfair.
--
-- This migration makes match-pick locking STRICT and unconditional:
--   • a match that has STARTED — kickoff time has passed, OR status is 'live' —
--     is never pickable, regardless of any grace setting;
--   • a FINISHED match is never pickable (unchanged, kept from 0013).
-- The match-pick grace is therefore inert. fb_match_picks_grace_active() and its
-- admin RPC are LEFT IN PLACE (harmless, still referenced by tests/back-compat)
-- but the lock no longer consults them. The grace value is cleared below so the
-- state is honest. The long-shot (0007) and round-props (0008) graces are
-- UNTOUCHED — they govern tournament-long picks / round specials, not matches.
--
-- Every other guard from 0013 is preserved verbatim: the move-match block, the
-- server-only points_awarded write (blocked on UPDATE, neutralized on INSERT),
-- the scorer-annotation fast path, and the 0009 cascade-cleanup. Idempotent:
-- pure CREATE OR REPLACE; the trigger binding is unchanged.
-- ════════════════════════════════════════════════════════════════════════════

-- Turn the (now-inert) match-pick grace off so the live state matches behaviour.
update public.settings set match_picks_grace_until = null where id;

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

  -- points_awarded is server-controlled. A client may never set it: block the
  -- UPDATE, and silently neutralize any value supplied on INSERT.
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'UPDATE' and NEW.points_awarded is distinct from OLD.points_awarded then
      raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
        using errcode = 'insufficient_privilege';
    elsif TG_OP = 'INSERT' then
      NEW.points_awarded := null;
    end if;
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

  -- A finished match is NEVER pickable — independent of the stored kickoff.
  if v_status = 'finished' then
    raise exception 'FoodBall: picks for match % are locked — it has finished', v_match
      using errcode = 'check_violation';
  end if;

  -- A match that has STARTED is never pickable: kickoff has passed, or it is
  -- already live. No grace bypass — predictions are final once the match begins.
  if now() >= v_kickoff or v_status = 'live' then
    raise exception 'FoodBall: picks for match % are locked — the match has started (kickoff %)',
      v_match, v_kickoff using errcode = 'check_violation';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
