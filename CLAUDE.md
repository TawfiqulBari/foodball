# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: all milestones (M1–M5) built & verified

**M1 (core loop), M2 (full markets + avatars), M3 (auto-sync + realtime), M4 (the
fun layer), and M5 (the optional Remotion recap) are all built and their acceptance
checklists pass.** The product is feature-complete against the spec.

**🔴 LIVE NOW** at https://foodball.tawfiqulbari.work on the **real World Cup 2026**
(48 teams, 72 group-stage fixtures imported from openfootball; matches go live at
their real kickoff via a token-free pg_cron). **Scores are admin-entered** until a
results feed is wired (see `session_status.md` "Remaining"). The remaining work is
that one data wiring + knockout fixtures, not features. When extending, keep verifying
each milestone's acceptance checklist (spec §9) and re-running the test suites. See
`session_status.md` for the latest run/verify snapshot + the live-ops details. The
canonical source of truth remains `plans/worldcup-league-claude-code-prompt.md` — read
it before extending. Brand assets live in `plans/` and `public/branding/` (+ a
`/branding/` copy the spec expects).

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
  reduced-motion aware), podium/row layout animation, and rivals pinning. **Live
  tournament added:** a green shadcn-style theme (light/dark tokens in `index.css` +
  `tailwind.config.ts`), a first-run + bottom-nav **guide** (`More`/guide tab + a
  Remotion `public/guide.mp4`), the animated **Match Day** stadium (`MatchPitch` +
  `FieldPlayer` + `kits.ts` — accurate home kits for all 48 nations + a Croatia checker
  pattern, plus a **live match clock**), a **commentary feed** (`CommentaryFeed`), the
  three grace banners, and Admin "Launch tools" (grace windows + signup-domain allowlist
  + commentary composer + celebration smoke test). Lucide icons; Plus Jakarta Sans + Inter.
- **Database** — `supabase/migrations/` `0001_init.sql` (M1 schema + RLS + pick-lock
  trigger + outcome scoring), `0002_m2_markets_props_decay.sql` (all-market scoring,
  round-prop settlement, tournament decay scoring, revision-window trigger +
  `fb_set_tourney_pick`, decay helpers mirroring `src/lib/decay.ts`), and
  `0003_m3_autosync_realtime.sql` (`fb_ingest_result` with manual precedence + auto
  scoring, `rank_history` + `rank_delta`, the Realtime publication),
  `0004_sync_results_cron.sql` (pg_cron schedule — Supabase-only), and
  `0005_grants.sql` (the `anon`/`authenticated` table grants PostgREST needs — these
  live only in the harness's `02_grants.sql` otherwise, so a real Supabase deploy
  needs this migration). **Live-tournament migrations** (`0006`–`0013`):
  `0006_commentary.sql` (auto kickoff/goal/FT lines + admin-posted lines, realtime),
  `0007_longshot_grace.sql` / `0008_round_props_grace.sql` / `0011_match_picks_grace.sql`
  (three admin-tunable late-launch grace windows on a singleton `public.settings` row;
  each `fb_*_grace_active()` reads only its own column), `0009_cascade_pick_cleanup.sql`
  (let picks cascade-delete when their match is removed), `0010_auto_live_window.sql`
  (token-free pg_cron `foodball-auto-live` flips matches to `live` at kickoff),
  `0012_live_atmosphere.sql` (pg_cron `foodball-live-atmosphere`: brand-voice colour
  lines for live matches, always quoting the true score), `0013_pick_lock_hardening.sql`
  (audit fixes: finished-match guard unconditional; client `points_awarded` neutralized
  on INSERT for match + round-prop picks), and `0014_openfootball_results_sync.sql`
  (token-free auto-settle: the `http` extension fetches openfootball in-DB and pg_cron
  `foodball-openfootball-sync` settles finished group matches via `fb_ingest_result` —
  `fb_settle_from_openfootball_json(jsonb)` is the pure, testable core; manual results
  always win; inert where `http` is unavailable), and `0015_signup_domain_allowlist.sql`
  (a BEFORE INSERT trigger on `auth.users` restricts sign-ups to an admin-managed email-
  domain allowlist — `public.signup_allowed_domains`, seeded `infosonik.com`; fail-open
  when empty; admin RPCs `fb_admin_add_signup_domain`/`fb_admin_remove_signup_domain`).
  `supabase/seed.sql` seeds reference data +
  the §4.3 decay table. **Local Docker mounts the M2/M3 migrations as `01b_m2.sql` /
  `01c_m3.sql` (see compose); the CLI/hosted stack applies all of `supabase/migrations/`.**
  Apply a new migration to the live stack with
  `docker exec -i supabase_db_foodball psql -U postgres -d postgres -f -` and register
  it in `supabase_migrations.schema_migrations`.
- **Server acceptance tests** — `core_loop_test.sql` (M1),
  `m2_markets_props_decay_test.sql` (M2: markets, props, decay, the revision-window
  crux via RPC *and* raw insert), `m3_autosync_test.sql` (M3: a simulated API
  payload settles end-to-end with no admin action; a manual result is not overwritten),
  `m_grace_test.sql` (the three grace windows + `0013` lock-hardening: grace ON
  allows a post-kickoff still-playable pick, grace OFF locks it, a finished match is
  never pickable incl. the future-kickoff edge, forged `points_awarded` neutralized on
  INSERT, grace independence), and `m_openfootball_sync_test.sql` (`0014`: a published
  openfootball score self-settles + scores a match with no admin action; a manual result
  is never overwritten). **Run after any change to the schema or scoring.**
  *Caveat:* `core_loop`/`m2`/`m3` need `SEED-*` fixtures that exist only in the Docker
  test harness (`foodball-db-1`) — rebuild its volume (`down -v && up -d --build`) to
  run them; `m_grace_test.sql` runs against the live CLI stack (`supabase_db_foodball`)
  with `psql -f`.
- **Decay math (mandatory Vitest)** — `src/lib/decay.ts` + `decay.test.ts` verify
  every cell of spec §4.3; `src/lib/scoring.ts` holds the fixed market/prop point
  values The Menu renders (mirrors the SQL scorer).
- **Hardened Docker run** — `Dockerfile` + `docker-compose.yml` + `docker/`.
  `docker/db-init/` is a *local-only* shim that lets the identical migrations run
  on stock Postgres (Supabase provides `auth`/`auth.uid()`/roles natively).
- **Edge functions** — `supabase/functions/sync-fixtures/` (daily fixture upsert)
  and `sync-results/` (M3: polls live scores/results → `fb_ingest_result`; admin-JWT
  or `SYNC_SECRET`-gated; football-data.org→openfootball fallback, Zod-validated).
- **Recap (M5)** — `recap/` is a **separate** Remotion package (own `package.json`,
  not part of the web-app runtime). `npm run render -- --round=MD2` pulls the
  leaderboard via the service key (demo-data fallback offline) → `recap/out/recap-<round>.mp4`
  (9:16, ~35s: headline → top-3 podium w/ avatars → climber/faller → outro).
- Security control mapping in `docs/SECURITY.md`; how-to-run in `docs/RUNNING.md`.

Live-ops state (June 2026): the league runs the **real WC2026** group stage —
matches go live at kickoff (`foodball-auto-live`) and **self-settle from openfootball**
(`foodball-openfootball-sync`, `0014`), both token-free; **admin entry is the instant,
authoritative override** (always wins). Sign-ups are gated to an email-domain allowlist
(`0015`). Genuinely remaining: (1) **knockout fixtures** (the importer does the 72 group
games; knockouts are placeholders until teams are decided, and need ET/penalty winner
logic — admin-entered for now); (2) a **squads sync** to populate `players_catalog`
(until then Clean Plate / Top Chef / Golden Boot pickers stay empty, and Top Chef /
awards settle from admin-entered data); (3) optionally a `football-data.org` token for
faster/live scores (spec §10 — free tier may not cover WC2026, so openfootball + manual
stay the fallback). Tournament settlement (champion/finalists/awards) is admin-entered by
design. Optional polish: `lottie-react` is uninstalled — M4's celebrations use
framer-motion + the mascot + emoji/SVG confetti.

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
- **Results sync pipeline** (spec §6). *Built:* `sync-fixtures` (daily upsert, idempotent by `api_match_id`) and `sync-results` (polls scores → the `fb_ingest_result` RPC, which auto-scores a match the instant it flips to `finished` — no admin action — and cascades into round-prop settlement via `fb_score_match`/`fb_score_round`). Admin manual entry via `fb_admin_set_result`; tournament-long picks settle via `fb_admin_set_tournament_result`. **Manual always wins over API** — `fb_ingest_result` skips a match whose `result_source='manual'` and `status='finished'`. *Live, token-free:* on the self-hosted stack two pg_cron jobs run the loop with no API token — `foodball-auto-live` (`0010`) flips a match to `live` at its real kickoff, and `foodball-openfootball-sync` (`0014`) settles finished group matches from openfootball via `fb_ingest_result`. The `sync-results` Edge Function + its `foodball-sync-results` cron remain the path for a `football-data.org` token (and on hosted Supabase, where the in-DB `http` extension isn't available).
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

- **Recap MP4 (M5):** `cd recap && npm install && npm run render -- --round=MD2` →
  `recap/out/recap-MD2.mp4`. Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` for live
  data (else it renders demo data). Needs Remotion's headless Chromium + its system
  libs (on a fresh Linux box: `libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64
  libasound2t64 libxdamage1 …`); renders fine on a normal laptop.

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
