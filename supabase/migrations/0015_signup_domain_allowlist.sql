-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — restrict sign-ups to approved email domains (share the URL safely).
--
-- A BEFORE INSERT trigger on auth.users rejects any new account whose email
-- domain isn't on an admin-managed allowlist — enforced in the DB, so it holds
-- even if someone hits the auth API directly (not just the UI). Existing users
-- are unaffected (no re-insert). Fail-OPEN when the allowlist is empty, so an
-- accidental clear can't lock everyone out; we seed it with the office domain.
--
-- Admin tunes it via fb_admin_add_signup_domain / fb_admin_remove_signup_domain.
-- Portable: the auth.users trigger is created only where auth.users exists (skips
-- the stock-postgres test harness). Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.signup_allowed_domains (
  domain     text primary key,
  created_at timestamptz not null default now()
);
alter table public.signup_allowed_domains enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='signup_allowed_domains' and policyname='allowed_domains_admin_read') then
    create policy allowed_domains_admin_read on public.signup_allowed_domains
      for select to authenticated using (public.fb_is_admin());
  end if;
end $$;
grant select on public.signup_allowed_domains to authenticated;

-- Seed the office domain. Change/extend with the admin RPCs below.
insert into public.signup_allowed_domains (domain) values ('infosonik.com')
  on conflict (domain) do nothing;

-- Enforcement: reject a signup whose email domain isn't allowed (when an
-- allowlist is configured). SECURITY DEFINER so it can read the table during the
-- GoTrue insert regardless of the connecting role.
create or replace function public.fb_enforce_signup_domain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_domain text;
begin
  -- No allowlist configured → no restriction (fail-open).
  if not exists (select 1 from public.signup_allowed_domains) then
    return NEW;
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
end;
$$;

-- Bind the trigger only where auth.users exists (real Supabase / CLI stack).
do $$
begin
  if to_regclass('auth.users') is not null then
    drop trigger if exists trg_enforce_signup_domain on auth.users;
    create trigger trg_enforce_signup_domain
      before insert on auth.users
      for each row execute function public.fb_enforce_signup_domain();
  else
    raise notice '0015: auth.users absent — signup domain trigger skipped (test harness).';
  end if;
end $$;

-- Admin management. Pass a bare domain ("infosonik.com") or "@infosonik.com".
create or replace function public.fb_admin_add_signup_domain(p_domain text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v text := lower(ltrim(trim(coalesce(p_domain,'')), '@'));
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  if v = '' or v !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'FoodBall: not a valid domain: %', p_domain using errcode = 'check_violation';
  end if;
  insert into public.signup_allowed_domains (domain) values (v) on conflict (domain) do nothing;
end;
$$;

create or replace function public.fb_admin_remove_signup_domain(p_domain text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  delete from public.signup_allowed_domains where lower(domain) = lower(ltrim(trim(coalesce(p_domain,'')), '@'));
end;
$$;

revoke all on function public.fb_admin_add_signup_domain(text)    from public;
revoke all on function public.fb_admin_remove_signup_domain(text) from public;
grant execute on function public.fb_admin_add_signup_domain(text)    to authenticated;
grant execute on function public.fb_admin_remove_signup_domain(text) to authenticated;
