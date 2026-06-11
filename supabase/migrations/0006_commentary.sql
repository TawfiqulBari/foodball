-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — live text commentary for the Stadium page. Auto lines on kickoff /
-- goals / full-time (fires for BOTH manual admin results and API ingests, since
-- both UPDATE public.matches), plus admin-posted lines. Realtime-published so the
-- Stadium feed updates live.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.match_commentary (
  id         bigint generated always as identity primary key,
  match_id   bigint not null references public.matches(id) on delete cascade,
  minute     int,
  body       text not null,
  kind       text not null default 'note' check (kind in ('note', 'goal', 'card', 'ht', 'ft', 'ko')),
  created_at timestamptz not null default now()
);
create index if not exists match_commentary_idx on public.match_commentary (match_id, created_at desc);

alter table public.match_commentary enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'match_commentary' and policyname = 'commentary_read') then
    create policy commentary_read on public.match_commentary for select to authenticated using (true);
  end if;
end
$$;
grant select on public.match_commentary to anon, authenticated;

-- Auto-commentary: when a match row changes, narrate kickoff, each goal, full time.
create or replace function public.fb_auto_commentary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare hn text; an text;
begin
  select fifa_code into hn from public.teams where id = NEW.home_team;
  select fifa_code into an from public.teams where id = NEW.away_team;

  if NEW.status = 'live' and OLD.status is distinct from 'live' then
    insert into public.match_commentary (match_id, body, kind)
      values (NEW.id, 'Kick-off! ' || hn || ' v ' || an || ' is under way.', 'ko');
  end if;

  if coalesce(NEW.home_score, 0) > coalesce(OLD.home_score, 0) then
    insert into public.match_commentary (match_id, body, kind)
      values (NEW.id, 'GOAL! ' || hn || ' find the net — ' || coalesce(NEW.home_score,0) || '–' || coalesce(NEW.away_score,0) || '.', 'goal');
  end if;
  if coalesce(NEW.away_score, 0) > coalesce(OLD.away_score, 0) then
    insert into public.match_commentary (match_id, body, kind)
      values (NEW.id, 'GOAL! ' || an || ' strike back — ' || coalesce(NEW.home_score,0) || '–' || coalesce(NEW.away_score,0) || '.', 'goal');
  end if;

  if NEW.status = 'finished' and OLD.status is distinct from 'finished' then
    insert into public.match_commentary (match_id, body, kind)
      values (NEW.id, 'Full time — ' || hn || ' ' || coalesce(NEW.home_score,0) || '–' || coalesce(NEW.away_score,0) || ' ' || an || '.', 'ft');
  end if;
  return NEW;
end;
$$;
drop trigger if exists trg_match_commentary on public.matches;
create trigger trg_match_commentary
  after update on public.matches
  for each row execute function public.fb_auto_commentary();

-- Admin posts a manual line (minute optional).
create or replace function public.fb_admin_post_commentary(
  p_match_id bigint,
  p_body     text,
  p_minute   int  default null,
  p_kind     text default 'note'
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v_id bigint;
begin
  if not public.fb_is_admin() then
    raise exception 'FoodBall: admin only' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'FoodBall: commentary needs text' using errcode = 'check_violation';
  end if;
  insert into public.match_commentary (match_id, minute, body, kind)
    values (p_match_id, p_minute, p_body, coalesce(p_kind, 'note'))
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.fb_admin_post_commentary(bigint, text, int, text) from public;
grant execute on function public.fb_admin_post_commentary(bigint, text, int, text) to authenticated;

-- Realtime (guarded: only on a stack that has the publication).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_commentary') then
      alter publication supabase_realtime add table public.match_commentary;
    end if;
  end if;
end
$$;
