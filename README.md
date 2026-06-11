<p align="center">
  <img src="branding/foodball-wordmark.svg" alt="FoodBall" width="420" />
</p>

<p align="center"><strong>Predict. Feast. Repeat.</strong> · <em>Champion eats free.</em> 🍔⚽</p>

---

**FoodBall** is a $0-infrastructure, mobile-first prediction league for an office
to play the **FIFA World Cup 2026**. Predict match outcomes, earn **points**
(never money — this is *not* gambling), climb **The Food Chain**, and the winner
eats free. ~6 weeks of fun, then archive.

> Built milestone by milestone from [`plans/worldcup-league-claude-code-prompt.md`](plans/worldcup-league-claude-code-prompt.md).
> **Milestone 1 (core loop) is done and verified.**

## What's in Milestone 1

Magic-link auth · Matches screen with outcome picks · **server-side pick-locking**
(the DB rejects a pick after kickoff even if the UI is bypassed) · admin manual
result entry · authoritative outcome scoring with the **underdog ×2** multiplier ·
a live leaderboard. All scoring/locking lives in Postgres — the client is never
trusted.

## Quickstart (hardened Docker)

```bash
openssl rand -base64 32 | tr -d '\n' > secrets/db_password.txt && chmod 600 secrets/db_password.txt
docker compose -p foodball up -d --build      # → http://127.0.0.1:8090
```

Run the server-side acceptance test (proves the M1 checklist):

```bash
docker compose -p foodball exec -T db sh -c \
  'PGPASSWORD=$(cat /run/secrets/db_password) psql -U foodball -d foodball -v ON_ERROR_STOP=1 -f /tests/core_loop_test.sql'
```

Full instructions (incl. the Supabase CLI path for real browser auth) →
[`docs/RUNNING.md`](docs/RUNNING.md). Security control mapping (CIS / NIST /
SOC 2) → [`docs/SECURITY.md`](docs/SECURITY.md).

## Stack

Vite · React 18 · TypeScript (strict) · Tailwind · Supabase (Postgres + Auth +
RLS + Edge Functions). See [`CLAUDE.md`](CLAUDE.md) for architecture and the
conventions that keep the pun intact.
