-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — token-free "atmosphere" commentary for live matches.
--
-- Real auto-commentary fires only on real events (kickoff / each goal / full
-- time — see 0006). With no live data feed, a live match that's still 0–0 shows
-- just the kickoff line. This adds brand-voice colour lines every few minutes for
-- matches that are 'live', so the Stadium feed feels alive — WITHOUT inventing
-- events: every line quotes the TRUE current score, nothing more.
--
-- Goal/kickoff/FT lines (admin entry or API) always take precedence and are
-- never crowded out — the ticker skips a match whose last line is recent.
-- Idempotent: CREATE OR REPLACE + cron.schedule() replaces a same-named job.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.fb_live_atmosphere()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m        record;
  hn       text;
  an       text;
  last_at  timestamptz;
  idx      int;
  line     text;
  n        int := 0;
  pool     text[] := array[
    '🍳 The Stadium kitchen is sizzling — {hn} {h}–{a} {an}.',
    '🔥 End-to-end stuff out there. Still {h}–{a}.',
    '🍔 The Food Chain is glued to every kick. {h}–{a}.',
    '🌶️ Spice levels rising — {hn} {h}–{a} {an}.',
    '🍴 Tension thick as gravy. {h}–{a}.',
    '👀 Someone fetch the halftime snacks — {h}–{a}.',
    '⚡ Still simmering at {h}–{a}.',
    '🥁 FoodBall fans on the edge of their seats. {hn} {h}–{a} {an}.'
  ];
begin
  for m in select * from public.matches where status = 'live' loop
    select created_at into last_at
      from public.match_commentary where match_id = m.id
      order by created_at desc limit 1;
    -- Leave room for real event lines; don't spam.
    if last_at is not null and now() - last_at < interval '4 minutes' then
      continue;
    end if;

    select fifa_code into hn from public.teams where id = m.home_team;
    select fifa_code into an from public.teams where id = m.away_team;

    -- Deterministic rotation through the pool by how many colour lines exist.
    select count(*) into idx from public.match_commentary where match_id = m.id and kind = 'note';
    line := pool[1 + (idx % array_length(pool, 1))];
    line := replace(line, '{hn}', coalesce(hn, '?'));
    line := replace(line, '{an}', coalesce(an, '?'));
    line := replace(line, '{h}',  coalesce(m.home_score, 0)::text);
    line := replace(line, '{a}',  coalesce(m.away_score, 0)::text);

    insert into public.match_commentary (match_id, body, kind) values (m.id, line, 'note');
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public.fb_live_atmosphere() from public;

-- Every 2 minutes; the function itself caps each match to one line per ~4 min.
select cron.schedule('foodball-live-atmosphere', '*/2 * * * *', $$select public.fb_live_atmosphere();$$);
