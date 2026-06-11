-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — allow pick rows to cascade-delete when their match is removed.
--
-- The pick-lock trigger blocks deleting/altering a pick after kickoff. But when
-- an admin removes a MATCH (e.g. clearing demo fixtures), the FK cascade deletes
-- its picks, firing this same trigger — and by then the parent match row is gone,
-- so the existence check raised "match does not exist" and aborted the teardown.
--
-- Fix: on DELETE, if the parent match no longer exists, the lock is moot — allow
-- it. The fairness guarantee is unchanged: deleting a pick while its match still
-- exists and is locked is still rejected; clients cannot delete matches (RLS).
-- Idempotent: pure CREATE OR REPLACE, trigger binding unchanged.
-- ════════════════════════════════════════════════════════════════════════════

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

  select kickoff into v_kickoff from public.matches where id = v_match;
  if v_kickoff is null then
    -- ★ Parent match gone (cascade teardown) — nothing left to lock. Allow the
    -- cascade to remove this pick; reject a stray insert/update with no match.
    if TG_OP = 'DELETE' then return OLD; end if;
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
