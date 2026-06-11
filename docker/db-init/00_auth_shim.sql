-- ════════════════════════════════════════════════════════════════════════════
-- LOCAL DOCKER ONLY. Supabase provides all of this natively; here we recreate
-- the minimal surface the migration depends on (auth schema, auth.uid(), roles)
-- so the IDENTICAL migration runs on stock postgres:16-alpine. Do NOT ship this
-- to a hosted Supabase project.
-- ════════════════════════════════════════════════════════════════════════════
create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- Mirrors Supabase's auth.uid(): the 'sub' claim of the request JWT, surfaced as
-- a GUC. Our SQL tests set it with `set request.jwt.claim.sub = '<uuid>'`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Roles the migration's policies/grants reference. service_role bypasses RLS,
-- matching Supabase semantics (and the SECURITY DEFINER scorer).
do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Let the app DB user assume the request roles (PostgREST-style) in the harness.
grant anon, authenticated, service_role to current_user;
