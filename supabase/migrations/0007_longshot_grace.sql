-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — LAUNCH GRACE WINDOW for tournament-long picks ("long shots").
--
-- The tournament kicked off (MD1) before any player joined, so the pre-tournament
-- window closed unused and long shots would only ever open at the decayed 70-pt
-- tier. This grace window lets ALL players set/change long shots at FULL value
-- (set_after_round = NULL → "Before MD1") until a configurable cut-off, regardless
-- of whether a round is in progress. Enforced server-side in the same trigger that
-- already governs long-shot picks; the client checks are cosmetic only.
--
-- Idempotent (safe to re-run). No change to existing picks: only NEW inserts during
-- the grace window are affected; stored set_after_round on existing rows is untouched.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Singleton settings table (create if absent) ─────────────────────────────
create table if not exists public.settings (
  id                   boolean primary key default true,
  longshot_grace_until timestamptz,
  constraint settings_singleton check (id)
);

-- Default grace: until 2026-06-14 23:59 Asia/Dhaka (UTC+6). Only seeds the row if
-- the table was just created / empty — never overwrites an admin-tuned value.
insert into public.settings (id, longshot_grace_until)
values (true, timestamptz '2026-06-14 23:59:00+06')
on conflict (id) do nothing;

alter table public.settings enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'settings' and policyname = 'settings_read') then
    create policy settings_read on public.settings for select to authenticated using (true);
  end if;
end
$$;
grant select on public.settings to anon, authenticated;

-- ── Grace state ─────────────────────────────────────────────────────────────
create or replace function public.fb_longshot_grace_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select longshot_grace_until from public.settings where id) > now(), false);
$$;

-- The revision window is open during the grace window OR (the original rule) when
-- no round is currently in progress.
create or replace function public.fb_tourney_revision_open()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fb_longshot_grace_active()
      or not exists (
           select 1 from public.rounds
            where first_kickoff is not null and now() >= first_kickoff and not completed
         );
$$;

-- The long-shot lock/anti-cheat trigger — re-defined to stamp set_after_round = NULL
-- (pre-tournament, full value) for picks made during the grace window, otherwise the
-- latest-completed-round bucket. The trigger object is unchanged (it binds by name).
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
    -- ★ grace window → full pre-tournament value; otherwise the decayed bucket.
    NEW.set_after_round := case
      when public.fb_longshot_grace_active() then null
      else public.fb_decay_bucket(public.fb_latest_completed_round())
    end;
    NEW.points_awarded := null;   -- server-scored only
    NEW.superseded_by  := null;   -- a fresh pick is active
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
  return NEW;
end;
$$;

-- ── Admin: set / clear the grace window (pass NULL to clear) ─────────────────
create or replace function public.fb_admin_set_longshot_grace(p_until timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  insert into public.settings (id, longshot_grace_until) values (true, p_until)
  on conflict (id) do update set longshot_grace_until = excluded.longshot_grace_until;
end;
$$;

revoke all on function public.fb_admin_set_longshot_grace(timestamptz) from public;
grant execute on function public.fb_admin_set_longshot_grace(timestamptz) to authenticated;
grant execute on function public.fb_longshot_grace_active()             to authenticated;
