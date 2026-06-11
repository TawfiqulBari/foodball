-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — LATE-START GRACE for round specials (Top Chef / Clean Plate / Spice).
--
-- The round-prop lock fires at the round's first kickoff. Because the league
-- started after MD1 had already kicked off, the MD1 specials locked before anyone
-- could pick them. This grace window keeps round specials open (settable/
-- changeable by everyone) until a configurable cut-off, regardless of kickoff.
-- Enforced in the same server-side trigger that already locks round props.
--
-- Idempotent. No change to existing round_props rows; only the lock check is
-- relaxed while grace is active. Mirrors the long-shot grace (0007).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.settings add column if not exists round_props_grace_until timestamptz;

-- Open by default for the launch — only if unset, so re-runs never clobber an
-- admin-tuned value. Until 2026-06-14 23:59 Asia/Dhaka (UTC+6).
update public.settings
   set round_props_grace_until = timestamptz '2026-06-14 23:59:00+06'
 where id and round_props_grace_until is null;

create or replace function public.fb_round_props_grace_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select round_props_grace_until from public.settings where id) > now(), false);
$$;

-- Re-define the round-prop lock to skip the kickoff lock while grace is active.
-- (Trigger object unchanged — it binds by name.)
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
  -- ★ grace window keeps round specials open despite a passed kickoff.
  if v_lock is not null and now() >= v_lock and not public.fb_round_props_grace_active() then
    raise exception 'FoodBall: round-prop picks for % are locked — the round has started (%)',
      v_round, v_lock using errcode = 'check_violation';
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;

-- Admin: set / clear the round-specials grace (pass NULL to clear).
create or replace function public.fb_admin_set_round_props_grace(p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  insert into public.settings (id, round_props_grace_until) values (true, p_until)
  on conflict (id) do update set round_props_grace_until = excluded.round_props_grace_until;
end;
$$;

revoke all on function public.fb_admin_set_round_props_grace(timestamptz) from public;
grant execute on function public.fb_admin_set_round_props_grace(timestamptz) to authenticated;
grant execute on function public.fb_round_props_grace_active()             to authenticated;
