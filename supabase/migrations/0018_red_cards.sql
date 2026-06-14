-- ════════════════════════════════════════════════════════════════════════════
-- FoodBall — RED CARDS: a durable record of voided picks + points cut off.
--
-- When a prediction set after kickoff is voided (it should never have been
-- allowed — see `0016`), we delete the pick + its `score_events` so the
-- leaderboard recomputes. This table keeps the human-readable record of WHY
-- points were cut, so the app can show a transparent "Red Cards" page.
--
-- One row per voided pick. `match_label` is denormalized so the card still reads
-- correctly if the match is later removed. `points_deducted` is what that pick
-- had scored at void time (0 for an unsettled/live match or a wrong pick).
--
-- Visibility: readable by everyone (it's a social game — transparency keeps it
-- fair). Only admins/server write it. Idempotent (IF NOT EXISTS + CREATE OR
-- REPLACE policies are dropped/recreated).
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.red_cards (
  id                    bigint generated always as identity primary key,
  user_id               uuid not null references public.profiles(id) on delete cascade,
  match_id              bigint references public.matches(id) on delete set null,
  match_label           text not null,
  market                text not null,
  selection             text not null,
  points_deducted       integer not null default 0,
  kickoff               timestamptz,
  picked_at             timestamptz,
  minutes_after_kickoff integer,
  reason                text not null default 'Prediction set after kickoff — voided',
  created_at            timestamptz not null default now()
);

create index if not exists red_cards_user_idx on public.red_cards(user_id);

alter table public.red_cards enable row level security;

drop policy if exists red_cards_read  on public.red_cards;
drop policy if exists red_cards_admin on public.red_cards;

-- Everyone can read the red cards (transparency).
create policy red_cards_read on public.red_cards
  for select to authenticated, anon using (true);

-- Only admins may write (server/admin populates it; the client never does).
create policy red_cards_admin on public.red_cards
  for all to authenticated
  using (public.fb_is_admin()) with check (public.fb_is_admin());

grant select on public.red_cards to authenticated, anon;
grant insert, update, delete on public.red_cards to authenticated;  -- gated by RLS to admins
