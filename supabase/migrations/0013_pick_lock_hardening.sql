-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — pick-lock hardening (from the 0011 adversarial audit).
--
-- Two low-severity, non-authoritative gaps the audit reproduced:
--   (1) The "finished match is never pickable" guard sat INSIDE the
--       `now() >= kickoff` branch, so a finished match with a (anomalous) future
--       kickoff fell through and was pickable. Make the finished check
--       UNCONDITIONAL so the guarantee holds regardless of the stored kickoff.
--   (2) points_awarded is server-controlled, but the guard only covered UPDATE —
--       a client could supply a forged points_awarded on INSERT. It is cosmetic
--       (the leaderboard sums score_events, and fb_score_match overwrites the row
--       at settle), but it breaks the trigger's own stated invariant. Neutralize
--       any client-supplied points_awarded on INSERT, mirroring fb_enforce_tourney_pick.
--
-- Applies the same INSERT neutralization to the round-prop trigger (same gap).
-- Preserves every prior behaviour: launch graces (0007/0008/0011), cascade
-- cleanup (0009), the move-match guard, and the scorer-annotation fast path.
-- Idempotent: pure CREATE OR REPLACE; trigger bindings unchanged.
-- ════════════════════════════════════════════════════════════════════════════

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

  -- Past kickoff: locked, unless the launch grace is active (0011).
  if now() >= v_kickoff and not public.fb_match_picks_grace_active() then
    raise exception 'FoodBall: picks for match % are locked — kickoff (%) has passed',
      v_match, v_kickoff using errcode = 'check_violation';
  end if;

  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- Round props share the analogous INSERT gap. Re-define preserving 0008's grace.
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
  if current_user in ('authenticated', 'anon') then
    if TG_OP = 'UPDATE' and NEW.points_awarded is distinct from OLD.points_awarded then
      raise exception 'FoodBall: points_awarded is server-controlled, not client-writable'
        using errcode = 'insufficient_privilege';
    elsif TG_OP = 'INSERT' then
      NEW.points_awarded := null;
    end if;
  end if;
  if not v_changes then
    return NEW;   -- scorer annotation — allowed
  end if;
  select first_kickoff into v_lock from public.rounds where key = v_round;
  -- grace window keeps round specials open despite a passed kickoff (0008).
  if v_lock is not null and now() >= v_lock and not public.fb_round_props_grace_active() then
    raise exception 'FoodBall: round-prop picks for % are locked — the round has started (%)',
      v_round, v_lock using errcode = 'check_violation';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
