# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: Milestone 1 scaffolded & verified

**M1 (core loop) is built.** Work **milestone by milestone (M1→M5)**, verifying each
milestone's acceptance checklist (spec §9) before the next. The canonical source
of truth remains `plans/worldcup-league-claude-code-prompt.md` — read it before
extending. Brand assets live in `plans/` and `public/branding/` (+ a `/branding/`
copy the spec expects).

What exists now:
- **Frontend** — Vite + React 18 + TS (strict) + Tailwind in `src/` (screens:
  Login, Matches, Leaderboard, MyPicks, More, Admin; `lib/` data access; `auth/`
  provider). Auth is **email + password** (changed from the spec's magic-link to
  avoid an SMTP dependency for the office launch — see `docs/DEPLOYMENT.md`). No
  router dep — a `useState` tab switch keeps deps within spec §2.
- **Database** — `supabase/migrations/0001_init.sql` is the full schema + RLS +
  the server-side pick-lock trigger + idempotent outcome scoring + admin RPCs.
  `supabase/seed.sql` seeds deterministic fixtures.
- **Server acceptance test** — `supabase/tests/core_loop_test.sql` proves the M1
  checklist at the DB tier (lock rejection, pre-lock invisibility, scoring, admin
  guard, idempotency). **Run it after any change to the schema or scoring.**
- **Hardened Docker run** — `Dockerfile` + `docker-compose.yml` + `docker/`.
  `docker/db-init/` is a *local-only* shim that lets the identical migration run
  on stock Postgres (Supabase provides `auth`/`auth.uid()`/roles natively).
- **Edge function** — `supabase/functions/sync-fixtures/` (football-data.org →
  openfootball fallback, Zod-validated, idempotent).
- Security control mapping in `docs/SECURITY.md`; how-to-run in `docs/RUNNING.md`.

Not yet built (later milestones): exact-score/BTTS/over-under markets, round
props, tournament-long picks + decay, avatars/PWA, auto-sync cron + realtime,
the result-moment overlays. The schema already has the tables for these.

## What FoodBall is

A $0-infrastructure, mobile-first PWA prediction league for ~20–50 office colleagues to predict FIFA World Cup 2026 outcomes (Jun 11 – Jul 19, 2026). Players earn **points** (never money) for correct picks; a live leaderboard ranks them; the winner gets a real-world office prize ("Champion eats free"). ~6-week lifespan, then archived — optimize for speed and fun, not enterprise longevity.

## Tech stack (do not add anything outside this without asking — spec §2)

This is the **approved dependency allow-list**; don't add anything outside it without asking. Items marked *(planned)* are sanctioned by the spec but **not yet installed** — M1 only pulls in what the core loop needs.

- **Frontend:** Vite + React 18 + TypeScript (strict, no `any`) + Tailwind v3. PWA via `vite-plugin-pwa` *(planned, M2)*.
- **Animation:** `framer-motion` (UI/avatars), `lottie-react` (celebrations; bundle JSON locally in `src/assets/lottie/`) *(planned, ~M4)*.
- **Avatars:** DiceBear (`@dicebear/core` + `@dicebear/collection`), rendered client-side as SVG, seeded from display name, no external image requests *(planned, ~M4)*.
- **Backend:** Supabase free tier — Postgres, Auth (**email + password**, not magic-link — see "Current state" above), Realtime, Edge Functions, `pg_cron`.
- **Installed today:** runtime `@supabase/supabase-js`, `react`, `react-dom`, `zod`; tooling Vite + `@vitejs/plugin-react`, Tailwind, `vitest`, `tsx` (see `package.json`).
- **Hosting:** Vercel/Netlify (frontend) + Supabase (everything else).
- **Results data:** football-data.org API (`WC`, 10 calls/min) primary → openfootball `worldcup.json` fallback → manual admin entry (must always work).
- **Recap (M5, optional):** Remotion in a **separate `/recap` package**, not part of the web app runtime.

## Architecture: where the important rules live

The big picture that spans many files:

- **Scoring is server-authoritative. The client never computes authoritative points.** All scoring lives in Postgres functions / Supabase Edge Functions. The data model centers on a `score_events` ledger kept idempotent by upsert on `(source_table, source_id)` — re-scoring updates a row in place, never duplicates. `leaderboard` is a `security_invoker` VIEW in M1 (always consistent); M3 swaps in a materialized view + Realtime. See spec §5 for the full schema and §6 for the sync/scoring functions.
- **Pick-locking is enforced server-side, never on the client clock.** A pick becomes immutable once its lock time passes, enforced via Postgres RLS + a `before insert/update` trigger comparing against the kickoff/round time stored in the DB. The M1 checklist explicitly requires that a post-kickoff pick is rejected even when the client UI is bypassed (test with a raw REST call).
- **The "round" concept (MD1, MD2, MD3, R32, R16, QF, SF, F) drives lock and revision windows.** Only the round *keys* are hardcoded; all dates/fixtures are seeded from the API at setup time, not hardcoded. A round completes when all its matches have final results, which settles round props and opens the tournament-pick revision window.
- **Three prediction tiers** (spec §4): per-match markets (lock at kickoff), per-round props (lock at round's first kickoff), and revisable tournament-long picks whose point value **decays** based on when the currently-held pick was last set. Decay values live in a `decay_schedule` DB table so the admin can tune them without code changes — read points from there, don't hardcode.
- **Results sync pipeline** (spec §6). *Built in M1:* `sync-fixtures` (daily upsert, idempotent by `api_match_id`, football-data.org→openfootball fallback, Zod-validated) + admin manual entry via the `fb_admin_set_result` RPC, which calls `fb_score_match` (outcome market only). *Planned for M3:* `sync-results` (`pg_cron` every 5 min, only inside match windows) → auto-invoke `fb_score_match` → tournament settle. **Manual admin entries always win over API** (`result_source='manual'`; sync skips manually-finalized matches).
- **RLS visibility rule:** everyone can read everything *after* lock time (it's a social game), but a pick is visible only to its owner *before* its lock time (prevents copying). Inserts/updates are own-rows-only and only before lock; `is_admin` bypasses.

## Validation & testing

- Zod-validate all Edge Function inputs and external API payloads.
- Mandatory Vitest coverage is the **decay math** (an M2 deliverable, verified against the table in spec §4.3) — it does **not exist yet**; M1 ships only `src/lib/format.test.ts` (display-only timing helpers). Authoritative scoring/locking is server-side, so it's tested at the **SQL tier** (`supabase/tests/core_loop_test.sql`), never in the frontend.

## Commands

- `npm install` then `npm run dev` — Vite dev server (needs `.env.local`; see `.env.example`).
- `npm run build` — typecheck (`tsc --noEmit`, strict) **then** `vite build`. `npm run lint` is the typecheck alone.
- `npm test` — Vitest (`npx vitest run <path>` or `-t "<name>"` for one). M1 has only
  `src/lib/format.test.ts`; the mandatory **decay-math** Vitest arrives in M2 (see
  "Validation & testing"). Authoritative scoring/locking is tested at the **SQL** tier
  (`supabase/tests/core_loop_test.sql`), never in Vitest.
- `npm run seed:demo` — seed 8 fake users on a *real* Supabase project (needs
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). Local Docker is seeded by `supabase/seed.sql`.
- **Run it (hardened Docker):** `docker compose -p foodball up -d --build` → app on
  `http://127.0.0.1:8090`. Full commands + the acceptance-test invocation + hardening
  verification are in `docs/RUNNING.md`. (Ports avoid the host's existing `:4000`/`:5432`.)
- **Run the M1 acceptance test** (after any schema/scoring change — it isn't auto-run):
  `docker compose -p foodball exec -T db sh -c 'PGPASSWORD=$(cat /run/secrets/db_password) psql -U foodball -d foodball -v ON_ERROR_STOP=1 -f /tests/core_loop_test.sql'`
- **Public go-live (self-host):** `docs/DEPLOYMENT.md` — Supabase CLI stack on this
  box, single-origin behind the host nginx + Let's Encrypt, email+password. Needs a
  hostname + Gmail SMTP app password (kept in `secrets/`, never committed).

(The M5 recap command `npm run render` and its `/recap` Remotion package don't exist yet — see "Not yet built".)

**Extending the schema/functions** (M2→M5): add a **new** numbered migration under
`supabase/migrations/` — never edit `0001_init.sql` in place (`supabase migration new <name>`).
Edge Functions live in `supabase/functions/<name>/` (`supabase functions deploy <name>`; only
`sync-fixtures` exists today). Re-run the SQL acceptance test after any migration.

## Gotchas worth knowing

- `LANGUAGE sql` functions (e.g. `fb_is_admin`) validate their body at creation —
  define them **after** the tables they reference (plpgsql defers, sql does not).
- The pick-lock trigger intentionally allows the scorer's `points_awarded` write
  (selection/market unchanged); it blocks only pick-content changes after kickoff.
- First-admin bootstrap: `fb_protect_profile` lets only trusted roles
  (`service_role`/`postgres`/superuser) set `is_admin`; `authenticated` users can't
  self-escalate. Don't make that trigger `SECURITY DEFINER` or `current_user` breaks.
- The local Docker DB uses `--auth-local=scram-sha-256`, so `psql` needs the
  password: `PGPASSWORD=$(cat /run/secrets/db_password) psql -U foodball -d foodball`.
- Two artifacts are **built-but-dormant** — don't recreate them and don't assume they're
  wired up: `<FoodBallMascot>` is fully implemented but has **zero imports** (staged for the
  M4 result overlays), and the `decay_schedule` table is **seeded but not read by any app
  code** yet (it becomes M2's source of truth for The Menu + tournament-pick decay).

## Non-negotiable conventions (easy to get wrong, will break the product)

- **Never "correct" the name FoodBall to Football** anywhere — repo, code, UI, docs. The food+football pun is the entire brand. Mascot = burger-football hybrid; tagline "Predict. Feast. Repeat."; motto "Champion eats free."
- **This is NOT gambling.** No money, wallets, currency, odds, or payouts. Use "predict / pick / points" — never "bet / stake / odds".
- **$0 infrastructure** — free tiers only. Ask before adding any paid service.
- **Use the FoodBall copy vocabulary consistently** (spec §8): Leaderboard→**The Food Chain**, exact-score hit→**Full Course**, correct outcome→**Chef's Kiss**, wrong pick→**Burnt Toast**, missed pick→**Skipped Lunch**, last place→**The Leftovers zone**. The round props are **Top Chef** / **Clean Plate** / **Spice of the Round**.
- **The rules page ("The Menu") must read its values from the scoring tables, never hand-duplicate them** so it can't drift from the code. ⚠️ M1's `src/screens/More.tsx` currently *hard-codes* the M1 rules (10 pts, underdog ×2) as a placeholder — wire it to `decay_schedule`/the scoring config before M2 introduces decay.
- **Reuse the mascot as one component** `<FoodBallMascot mood="happy|sad|spicy" />`, swapping eyes/extras per mood. Respect `prefers-reduced-motion` for all result-overlay animations.
- Display font **Luckiest Guy** (headings/points/celebrations); body Nunito or system sans. Palette and tokens in spec §8. Flag emoji for teams — no flag image assets.
- Secrets: frontend `.env.local` holds **only** the Supabase anon key + URL; the football-data.org token and service key are Supabase secrets, never in the frontend. Provide `.env.example`.
- If football-data.org's free tier turns out not to include WC 2026 data on first call, **say so immediately** and fall back to openfootball + manual entry rather than silently degrading.
