# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: Milestones 1–4 built & verified

**M1 (core loop), M2 (full markets + avatars), M3 (auto-sync + realtime), and M4
(the fun layer) are built and their acceptance checklists pass.** Work **milestone
by milestone (M1→M5)**, verifying each milestone's acceptance checklist (spec §9)
before the next. The canonical source of truth remains
`plans/worldcup-league-claude-code-prompt.md` — read it before extending. Brand
assets live in `plans/` and `public/branding/` (+ a `/branding/` copy the spec expects).

What exists now:
- **Frontend** — Vite + React 18 + TS (strict) + Tailwind in `src/` (screens:
  Login, Onboarding, Matches, Leaderboard, MyPicks, More, Admin; `lib/` data
  access; `auth/` provider). Auth is **email + password** (changed from the spec's
  magic-link to avoid an SMTP dependency — see `docs/DEPLOYMENT.md`). No router dep
  — a `useState` tab switch keeps deps within spec §2. **M2 added:** all per-match
  markets (exact-score/BTTS/over-under + the upset ×2), the three round props,
  tournament-long picks with decay + revision window + history, the DiceBear avatar
  builder/onboarding + avatars on the leaderboard, an installable **PWA**, and a
  "The Menu" rules page generated from the scoring tables. **M3 added:** a live
  Realtime leaderboard + live-score display + rank-change arrows (`rank_delta`).
  **M4 added:** result-moment overlays (`<ResultOverlay>`/`<ResultMoments>` — the
  reused `<FoodBallMascot>` + framer-motion + food-confetti, queued one-at-a-time,
  reduced-motion aware), podium/row layout animation, and rivals pinning.
- **Database** — `supabase/migrations/` `0001_init.sql` (M1 schema + RLS + pick-lock
  trigger + outcome scoring), `0002_m2_markets_props_decay.sql` (all-market scoring,
  round-prop settlement, tournament decay scoring, revision-window trigger +
  `fb_set_tourney_pick`, decay helpers mirroring `src/lib/decay.ts`), and
  `0003_m3_autosync_realtime.sql` (`fb_ingest_result` with manual precedence + auto
  scoring, `rank_history` + `rank_delta`, the Realtime publication). `supabase/seed.sql`
  seeds fixtures + the §4.3 decay table. **Local Docker mounts the M2/M3 migrations
  as `01b_m2.sql` / `01c_m3.sql` (see compose).**
- **Server acceptance tests** — `core_loop_test.sql` (M1),
  `m2_markets_props_decay_test.sql` (M2: markets, props, decay, the revision-window
  crux via RPC *and* raw insert), and `m3_autosync_test.sql` (M3: a simulated API
  payload settles end-to-end with no admin action; a manual result is not overwritten).
  **Run all three after any change to the schema or scoring.**
- **Decay math (mandatory Vitest)** — `src/lib/decay.ts` + `decay.test.ts` verify
  every cell of spec §4.3; `src/lib/scoring.ts` holds the fixed market/prop point
  values The Menu renders (mirrors the SQL scorer).
- **Hardened Docker run** — `Dockerfile` + `docker-compose.yml` + `docker/`.
  `docker/db-init/` is a *local-only* shim that lets the identical migrations run
  on stock Postgres (Supabase provides `auth`/`auth.uid()`/roles natively).
- **Edge functions** — `supabase/functions/sync-fixtures/` (daily fixture upsert)
  and `sync-results/` (M3: polls live scores/results → `fb_ingest_result`; admin-JWT
  or `SYNC_SECRET`-gated; football-data.org→openfootball fallback, Zod-validated).
- Security control mapping in `docs/SECURITY.md`; how-to-run in `docs/RUNNING.md`.

Not yet built: **M5** the optional Remotion `/recap` package (`npm run render`).
`lottie-react` is still uninstalled — M4's celebrations use framer-motion + the
mascot + emoji/SVG confetti (spec §7.5's "flying-food confetti" reading); drop in
LottieFiles JSON later if desired. Also not yet wired: the `pg_cron` schedule that
calls `sync-results` (the function + RPC exist and are tested; the cron entry is a
deploy step — see the header of `sync-results/index.ts`). Tournament settlement
(champion/finalists/awards) and knockout ET/penalty winners are **admin-entered**
(the API poll never overwrites them). Squad data (`players_catalog`) is empty until
a squads sync exists, so Clean Plate / Top Chef / Golden Boot pickers stay empty until then.

## What FoodBall is

A $0-infrastructure, mobile-first PWA prediction league for ~20–50 office colleagues to predict FIFA World Cup 2026 outcomes (Jun 11 – Jul 19, 2026). Players earn **points** (never money) for correct picks; a live leaderboard ranks them; the winner gets a real-world office prize ("Champion eats free"). ~6-week lifespan, then archived — optimize for speed and fun, not enterprise longevity.

## Tech stack (do not add anything outside this without asking — spec §2)

This is the **approved dependency allow-list**; don't add anything outside it without asking. Items marked *(planned)* are sanctioned by the spec but **not yet installed**.

- **Frontend:** Vite + React 18 + TypeScript (strict, no `any`) + Tailwind v3. PWA via `vite-plugin-pwa` *(installed, M2)*.
- **Animation:** `framer-motion` (UI/avatars/result overlays) *(installed, M4)*; `lottie-react` (celebrations; bundle JSON locally in `src/assets/lottie/`) *(planned/optional — not installed; M4 uses framer-motion + mascot + emoji confetti instead)*.
- **Avatars:** DiceBear (`@dicebear/core` + `@dicebear/collection`), client-side SVG seeded from display name, no external image requests *(installed, M2)*.
- **Backend:** Supabase free tier — Postgres, Auth (**email + password**, not magic-link — see "Current state" above), Realtime, Edge Functions, `pg_cron`.
- **Installed today:** runtime `@supabase/supabase-js`, `react`, `react-dom`, `zod`, `@dicebear/core`, `@dicebear/collection`, `framer-motion`; tooling Vite + `@vitejs/plugin-react`, Tailwind, `vitest`, `tsx`, `vite-plugin-pwa` (+ pinned `workbox-build@7.1.0` — 7.3+ breaks the plugin's ESM `require`). See `package.json`.
- **Hosting:** Vercel/Netlify (frontend) + Supabase (everything else).
- **Results data:** football-data.org API (`WC`, 10 calls/min) primary → openfootball `worldcup.json` fallback → manual admin entry (must always work).
- **Recap (M5, optional):** Remotion in a **separate `/recap` package**, not part of the web app runtime.

## Architecture: where the important rules live

The big picture that spans many files:

- **Scoring is server-authoritative. The client never computes authoritative points.** All scoring lives in Postgres functions / Supabase Edge Functions. The data model centers on a `score_events` ledger kept idempotent by upsert on `(source_table, source_id)` — re-scoring updates a row in place, never duplicates. `leaderboard` is a **`security_invoker` VIEW** (always consistent, fast enough for ~50 players); M3 added `rank_delta` from a per-round `rank_history` snapshot + Realtime push, and intentionally **kept the view rather than a materialized view** (a matview's REFRESH/RLS friction isn't worth it at this scale — revisit only if the player count grows). See spec §5 for the full schema and §6 for the sync/scoring functions.
- **Pick-locking is enforced server-side, never on the client clock.** A pick becomes immutable once its lock time passes, enforced via Postgres RLS + a `before insert/update` trigger comparing against the kickoff/round time stored in the DB. The M1 checklist explicitly requires that a post-kickoff pick is rejected even when the client UI is bypassed (test with a raw REST call).
- **The "round" concept (MD1, MD2, MD3, R32, R16, QF, SF, F) drives lock and revision windows.** Only the round *keys* are hardcoded; all dates/fixtures are seeded from the API at setup time, not hardcoded. A round completes when all its matches have final results, which settles round props and opens the tournament-pick revision window.
- **Three prediction tiers** (spec §4): per-match markets (lock at kickoff), per-round props (lock at round's first kickoff), and revisable tournament-long picks whose point value **decays** based on when the currently-held pick was last set. Decay values live in a `decay_schedule` DB table so the admin can tune them without code changes — read points from there, don't hardcode.
- **Results sync pipeline** (spec §6). *Built:* `sync-fixtures` (daily upsert, idempotent by `api_match_id`) and `sync-results` (polls scores → the `fb_ingest_result` RPC, which auto-scores a match the instant it flips to `finished` — no admin action — and cascades into round-prop settlement via `fb_score_match`/`fb_score_round`). Admin manual entry via `fb_admin_set_result`; tournament-long picks settle via `fb_admin_set_tournament_result`. **Manual always wins over API** — `fb_ingest_result` skips a match whose `result_source='manual'` and `status='finished'`. *Deploy step (not code):* the `pg_cron` entry that calls `sync-results` every 5 min — see `sync-results/index.ts`.
- **RLS visibility rule:** everyone can read everything *after* lock time (it's a social game), but a pick is visible only to its owner *before* its lock time (prevents copying). Inserts/updates are own-rows-only and only before lock; `is_admin` bypasses.

## Validation & testing

- Zod-validate all Edge Function inputs and external API payloads.
- The mandatory Vitest is the **decay math** — `src/lib/decay.test.ts` pins every cell of spec §4.3 (56 cases incl. group-stage bucketing and the "—" zero cells). `format.test.ts` covers display timing helpers. Authoritative scoring/locking is server-side, so it's tested at the **SQL tier** (`core_loop_test.sql` + `m2_markets_props_decay_test.sql`), never in the frontend. The SQL `fb_decay_*` helpers mirror `decay.ts`; both read `decay_schedule` so they can't drift — re-run **both** Vitest and the SQL tests after touching either.

## Commands

- `npm install` then `npm run dev` — Vite dev server (needs `.env.local`; see `.env.example`).
- `npm run build` — typecheck (`tsc --noEmit`, strict) **then** `vite build`. `npm run lint` is the typecheck alone.
- `npm test` — Vitest (`npx vitest run <path>` or `-t "<name>"` for one): `decay.test.ts`
  (mandatory, spec §4.3) + `format.test.ts`. Authoritative scoring/locking is tested at the
  **SQL** tier (see below), never in Vitest.
- `npm run seed:demo` — seed 8 fake users on a *real* Supabase project (needs
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`). Local Docker is seeded by `supabase/seed.sql`.
- **Run it (hardened Docker):** `docker compose -p foodball up -d --build` → app on
  `http://127.0.0.1:8090`. Full commands + the acceptance-test invocation + hardening
  verification are in `docs/RUNNING.md`. (Ports avoid the host's existing `:4000`/`:5432`.)
- **Run the SQL acceptance tests** (after any schema/scoring change — not auto-run). Swap
  the filename for `m2_markets_props_decay_test.sql` to run the M2 suite:
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
- `<FoodBallMascot>` is fully implemented but still **has zero imports** — staged for the
  M4 result overlays. Reuse it there; don't recreate it.
- **Tournament-pick anti-cheat** (M2): a client could otherwise forge a higher-value decay
  bucket or insert many "active" picks to guarantee a win. Two defenses: the
  `fb_enforce_tourney_pick` trigger *overwrites* `set_after_round` with the server-computed
  bucket on every insert (and enforces the revision window), and the scorer settles only the
  **latest** pick per `(user, pick_type)` — so extra inserts are just revision history, and
  `superseded_by` is for display, not authority.
- **`set_after_round` is a bucket, not a raw round.** The §4.3 "After MD1–MD3" column is one
  value, so group-stage picks store `'MD3'`; `fb_decay_bucket` / `decayBucket()` collapse
  MD1/MD2/MD3→`'MD3'` and `'F'`→`'SF'`. Keep `seed.sql`, `decay.ts`, and the SQL helpers in lockstep.
- **`vite-plugin-pwa` needs `workbox-build` pinned to `7.1.0`** — 7.3+ throws "Dynamic require
  of workbox-build is not supported" during `vite build` in this ESM project.

## Non-negotiable conventions (easy to get wrong, will break the product)

- **Never "correct" the name FoodBall to Football** anywhere — repo, code, UI, docs. The food+football pun is the entire brand. Mascot = burger-football hybrid; tagline "Predict. Feast. Repeat."; motto "Champion eats free."
- **This is NOT gambling.** No money, wallets, currency, odds, or payouts. Use "predict / pick / points" — never "bet / stake / odds".
- **$0 infrastructure** — free tiers only. Ask before adding any paid service.
- **Use the FoodBall copy vocabulary consistently** (spec §8): Leaderboard→**The Food Chain**, exact-score hit→**Full Course**, correct outcome→**Chef's Kiss**, wrong pick→**Burnt Toast**, missed pick→**Skipped Lunch**, last place→**The Leftovers zone**. The round props are **Top Chef** / **Clean Plate** / **Spice of the Round**.
- **The rules page ("The Menu", `src/screens/More.tsx`) reads its values from the scoring tables, never a hand-typed copy** so it can't drift. The decay grid is rendered live from `decay_schedule`; the fixed per-match/per-round point values come from `src/lib/scoring.ts` (the single TS mirror of the SQL scorer). If you change a point value, change it in `scoring.ts` *and* the SQL — don't add a third copy in the page.
- **Reuse the mascot as one component** `<FoodBallMascot mood="happy|sad|spicy" />`, swapping eyes/extras per mood. Respect `prefers-reduced-motion` for all result-overlay animations.
- Display font **Luckiest Guy** (headings/points/celebrations); body Nunito or system sans. Palette and tokens in spec §8. Flag emoji for teams — no flag image assets.
- Secrets: frontend `.env.local` holds **only** the Supabase anon key + URL; the football-data.org token and service key are Supabase secrets, never in the frontend. Provide `.env.example`.
- If football-data.org's free tier turns out not to include WC 2026 data on first call, **say so immediately** and fall back to openfootball + manual entry rather than silently degrading.
