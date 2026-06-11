-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — schedule the M3 results poller (spec §6.2).
--
-- ⚠️ SUPABASE / `supabase` CLI ONLY. Requires pg_cron + pg_net + Supabase Vault,
-- which the hosted project and the `supabase` CLI stack provide but the local
-- stock-postgres Docker harness does NOT. This file is therefore intentionally
-- NOT in docker-compose's init mounts — it is applied only by `supabase db push`
-- / `supabase migration up` against a real Supabase database.
--
-- One-time per environment, store the two values in Vault (never in git):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<your SYNC_SECRET>',                'sync_secret');
-- (use vault.update_secret(id, ...) to change them later).
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop any prior schedule before (re)creating it.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'foodball-sync-results') then
    perform cron.unschedule('foodball-sync-results');
  end if;
end
$$;

-- Every 5 minutes, but only actually call the Edge Function when a match window
-- is OPEN — a match that is live, or whose kickoff is within the last 3.5h
-- (spec §6.2). Off-window ticks evaluate the WHERE guard and make NO http call
-- (the target list isn't evaluated when no row qualifies), so they're free.
select cron.schedule(
  'foodball-sync-results',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/sync-results',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_secret')
    ),
    body := '{}'::jsonb
  )
  from (select 1) as tick
  where exists (
    select 1 from public.matches m
     where m.status = 'live'
        or (now() >= m.kickoff and now() < m.kickoff + interval '3.5 hours')
  );
  $job$
);

-- Verify after deploy:
--   select jobid, jobname, schedule, active from cron.job where jobname = 'foodball-sync-results';
--   select status, return_message, start_time from cron.job_run_details
--     where command like '%sync-results%' order by start_time desc limit 5;
