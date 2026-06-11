-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — token-free auto-live. Flip a match to 'live' the moment its real
-- kickoff passes, so the app shows matches as in-play without any external API.
--
-- The existing `foodball-sync-results` cron pulls SCORES (needs a football-data
-- token). This complements it: even with no token, every match turns live at its
-- scheduled kickoff (firing the auto kickoff commentary), and the admin enters
-- the final score — which sets 'finished', scores picks, and fires overlays.
--
-- We never auto-FINISH (that would settle a 0–0); finishing stays admin/API-only.
-- Idempotent: CREATE OR REPLACE + cron.schedule() replaces a same-named job.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fb_advance_live_windows()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare n integer;
begin
  update public.matches
     set status = 'live'
   where status = 'scheduled'
     and kickoff <= now()
     and now() < kickoff + interval '3.5 hours';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.fb_advance_live_windows() from public;

-- Run every minute so the live flip is snappy at kickoff. No-ops cheaply when
-- nothing is in window. cron.schedule replaces the job if it already exists.
select cron.schedule('foodball-auto-live', '* * * * *', $$select public.fb_advance_live_windows();$$);
