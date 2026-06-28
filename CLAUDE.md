# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: all milestones (M1–M5) built & verified

**M1 (core loop), M2 (full markets + avatars), M3 (auto-sync + realtime), M4 (the
fun layer), and M5 (the optional Remotion recap) are all built and their acceptance
checklists pass.** The product is feature-complete against the spec.

**🔴 LIVE NOW** at https://foodball.tawfiqulbari.work on the **real World Cup 2026**
(48 teams, 72 group-stage fixtures imported from openfootball). Matches go live at
their real kickoff (`foodball-auto-live`) and **self-settle from openfootball**
(`foodball-openfootball-sync`, `0014`), both token-free; **admin entry is the instant,
authoritative override**. **Match picks lock strictly at kickoff** (`0016`, no grace).
The **2026-06-14 session** added fairness hardening: the award pickers are seeded
(`0017`), post-kickoff picks were **voided + recomputed** with a **Red Cards** screen
(`0018`), and a 26-finding **logic audit** was remediated (`0019` — see
`docs/logic-audit-2026-06-14.md`). The **2026-06-28 session** wired knockout support into
`scripts/import-real-fixtures.mjs` and **imported the real Round of 32** (16 fixtures) as the
group stage ended, corrected **every** knockout round's lock time from openfootball (fixing
stale seed placeholders), and opened the R32 round specials with a 24h grace. Remaining is data
wiring (the rest of the knockout bracket as teams resolve, a full squads sync), not features.
When extending, keep verifying each milestone's acceptance
checklist (spec §9) and re-running the test suites. See `session_status.md` for the
latest run/verify snapshot + the live-ops details. The canonical source of truth remains
`plans/worldcup-league-claude-code-prompt.md` — read it before extending. Brand assets
live in `plans/` and `public/branding/` (+ a `/branding/` copy the spec expects).

What exists now:
- **Frontend** — Vite + React 18 + TS (strict) + Tailwind in `src/` (screens:
  Login, Onboarding, **Guide** (the first-run landing), Matches, **MatchDay** (the
  "Stadium" tab), Leaderboard, MyPicks, **RedCards** (voided post-kickoff picks + points
  cut off), More, Admin; `lib/` data access — `api.ts` is
  the central Supabase query/RPC module, `database.types.ts` the hand-kept row types,
  `copy.ts` the single source of the FoodBall copy vocabulary, and `matchField.ts`
  (Match Day side-assignment + **`pickLabel`**, the single source for rendering a pick as
  the team it backed) / `resultMoments.ts` the pure, unit-tested cores behind Match Day
  and the result overlays; `auth/` provider). Auth is **email + password** (changed from the spec's
  magic-link to avoid an SMTP dependency — see `docs/DEPLOYMENT.md`). No router dep
  — a `useState` tab switch keeps deps within spec §2. **M2 added:** all per-match
  markets (exact-score/BTTS/over-under + the upset ×2), the three round props,
  tournament-long picks with decay + revision window + history, the DiceBear avatar
  builder/onboarding + avatars on the leaderboard, an installable **PWA**, and a
  "The Menu" rules page generated from the scoring tables. **M3 added:** a live
  Realtime leaderboard + live-score display + rank-change arrows (`rank_delta`); the
  leaderboard rows **expand** to show that chef's per-match predictions (outcome rendered
  as the backed team via `pickLabel`; others' picks RLS-hidden until kickoff).
  **M4 added:** result-moment overlays (`<ResultOverlay>`/`<ResultMoments>` — the
  reused `<FoodBallMascot>` + framer-motion + food-confetti, queued one-at-a-time,
  reduced-motion aware), podium/row layout animation, and rivals pinning. **Live
  tournament added:** a green shadcn-style theme (light/dark tokens in `index.css` +
  `tailwind.config.ts`), a first-run + bottom-nav **guide** (`More`/guide tab + a
  Remotion `public/guide.mp4`), the animated **Match Day** stadium (`MatchPitch` +
  `FieldPlayer` + `kits.ts` — accurate home kits for all 48 nations + a Croatia checker
  pattern, plus a **live match clock**), a **commentary feed** (`CommentaryFeed`), the
  long-shot + round-props grace banners (the match-pick grace was removed in `0016` — match
  picks lock at kickoff), and Admin "Launch tools" (the long-shot/round-props grace windows
  + signup-domain allowlist + commentary composer + celebration smoke test). Lucide icons;
  Plus Jakarta Sans + Inter.
- **Database** — `supabase/migrations/` `0001_init.sql` (M1 schema + RLS + pick-lock
  trigger + outcome scoring), `0002_m2_markets_props_decay.sql` (all-market scoring,
  round-prop settlement, tournament decay scoring, revision-window trigger +
  `fb_set_tourney_pick`, decay helpers mirroring `src/lib/decay.ts`), and
  `0003_m3_autosync_realtime.sql` (`fb_ingest_result` with manual precedence + auto
  scoring, `rank_history` + `rank_delta`, the Realtime publication),
  `0004_sync_results_cron.sql` (pg_cron schedule — Supabase-only), and
  `0005_grants.sql` (the `anon`/`authenticated` table grants PostgREST needs — these
  live only in the harness's `02_grants.sql` otherwise, so a real Supabase deploy
  needs this migration). **Live-tournament migrations** (`0006`–`0019`):
  `0006_commentary.sql` (auto kickoff/goal/FT lines + admin-posted lines, realtime),
  `0007_longshot_grace.sql` / `0008_round_props_grace.sql` / `0011_match_picks_grace.sql`
  (three admin-tunable late-launch grace windows on a singleton `public.settings` row;
  each `fb_*_grace_active()` reads only its own column — but the match-pick one is later
  made **inert** by `0016`, see below), `0009_cascade_pick_cleanup.sql`
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
  when empty; admin RPCs `fb_admin_add_signup_domain`/`fb_admin_remove_signup_domain`), and
  **the pick-lock + data migrations** `0016_lock_match_picks_at_kickoff.sql` (per-match
  picks now lock the instant a match **starts** — kickoff passed **or** status `live` —
  with **no grace bypass**; the `0011` match-pick grace column/RPC are kept but inert and
  its admin control was removed; long-shot/round-props graces are untouched) and
  `0017_seed_players_catalog.sql` (seeds `players_catalog` with notable current players for
  the 48 live teams, so the Golden Boot / Golden Glove / Best Young Player pickers have
  options — settlement stays admin-entered), and `0018_red_cards.sql` (a durable
  `public.red_cards` record of voided picks + the points cut off — read-all/admin-write —
  powering the **Red Cards** screen; the one-time void itself is
  `scripts/void-post-kickoff-picks.sql`, with a reversible backup in
  `docs/voided-picks-backup-2026-06-14.sql`), and `0019_logic_audit_fixes.sql` (the
  remediation of `docs/logic-audit-2026-06-14.md`: cast-safe scorers + numeric CHECKs,
  **server-stamped/immutable `tourney_picks.created_at`** with the scorer ranking the active
  pick by immutable `id` (anti-cheat), RLS that reveals others' tourney/round picks only while
  locked, self-correcting round completion, `score_events` cleanup triggers on pick delete,
  a revision window that tolerates empty/finished rounds, `fb_ingest_result` never regressing a
  finished match, fail-CLOSED signup allowlist + email-change enforcement, and new admin RPCs
  `fb_admin_remove_tournament_result` / `fb_admin_set_round_complete`).
  `supabase/seed.sql` seeds reference data +
  the §4.3 decay table. **Local Docker mounts the M2/M3 migrations as `01b_m2.sql` /
  `01c_m3.sql` (see compose); the CLI/hosted stack applies all of `supabase/migrations/`.**
  Apply a new migration to the live stack with
  `docker exec -i supabase_db_foodball psql -U postgres -d postgres -f -` and register
  it in `supabase_migrations.schema_migrations`.
- **Server acceptance tests** (all under `supabase/tests/`) — `core_loop_test.sql` (M1),
  `m2_markets_props_decay_test.sql` (M2: markets, props, decay, the revision-window
  crux via RPC *and* raw insert), `m3_autosync_test.sql` (M3: a simulated API
  payload settles end-to-end with no admin action; a manual result is not overwritten),
  `m_grace_test.sql` (`0013`/`0016` pick-locking: an OPEN match is pickable, a **started**
  match — kickoff passed or `live` — rejects both new picks *and* changes **even with
  match-pick grace ON**, a finished match is never pickable incl. the future-kickoff edge,
  forged `points_awarded` neutralized on INSERT, long-shot/round-props graces independent),
  `m_audit_fixes_test.sql` (`0019`: created_at anti-cheat is immutable, total_goals is
  numeric/bounded, deleting a pick cleans its `score_events`, the scorer's numeric cast is
  griefing-safe), and `m_openfootball_sync_test.sql` (`0014`: a published
  openfootball score self-settles + scores a match with no admin action; a manual result
  is never overwritten). **Run after any change to the schema or scoring.**
  *Caveat:* `core_loop`/`m2`/`m3` need `SEED-*` fixtures that exist only in the Docker
  test harness (`foodball-db-1`) — rebuild its volume (`down -v && up -d --build`) to
  run them; `m_grace_test.sql` runs against the live CLI stack (`supabase_db_foodball`)
  with `psql -f`.
- **Decay math (mandatory Vitest)** — `src/lib/decay.ts` + `decay.test.ts` verify
  every cell of spec §4.3; `src/lib/scoring.ts` holds the fixed market/prop point
  values The Menu renders (mirrors the SQL scorer). `npm test` (`vitest run`) actually
  runs **four** suites: `decay.test.ts` (§4.3), `format.test.ts` (display timing),
  `matchField.test.ts` (Match Day side-assignment/kits/tabs/round-completion), and
  `resultMoments.test.ts` (M4 overlay moment classification + priority ordering).
- **Hardened Docker run** — `Dockerfile` + `docker-compose.yml` + `docker/`.
  `docker/db-init/` is a *local-only* shim that lets the identical migrations run
  on stock Postgres (Supabase provides `auth`/`auth.uid()`/roles natively).
- **Edge functions** — `supabase/functions/sync-fixtures/` (daily fixture upsert)
  and `sync-results/` (M3: polls live scores/results → `fb_ingest_result`; admin-JWT
  or `SYNC_SECRET`-gated; football-data.org→openfootball fallback, Zod-validated).
- **Recap (M5)** — `recap/` is a **separate** Remotion package (own `package.json`,
  not part of the web-app runtime). `npm run render -- --round=MD2` (`recap/render.mjs`)
  pulls the leaderboard via the service key (demo-data fallback offline) →
  `recap/out/recap-<round>.mp4` (9:16, ~35s: headline → top-3 podium w/ avatars →
  climber/faller → outro). A second renderer, `npm run render:guide` (`recap/render-guide.mjs`),
  produces the in-app how-to-play `public/guide.mp4` + poster.
- Security control mapping in `docs/SECURITY.md`; how-to-run in `docs/RUNNING.md`.

Live-ops state (June 2026): the league runs the **real WC2026** group stage —
matches go live at kickoff (`foodball-auto-live`) and **self-settle from openfootball**
(`foodball-openfootball-sync`, `0014`), both token-free; **admin entry is the instant,
authoritative override** (always wins). Sign-ups are gated to an email-domain allowlist
(`0015`). **Match picks lock strictly at kickoff** — no late-launch grace for matches
(`0016`); a started or live match is never pickable. Genuinely remaining: (1) **the rest of
the knockout bracket** — `scripts/import-real-fixtures.mjs` now imports knockouts too, and the
**Round of 32 is live** (16 real fixtures, imported 2026-06-28); R16/QF/SF/F fill in on a
**re-run** as their teams resolve (placeholder bracket slots are skipped until then). Every
knockout round's `first_kickoff` is already set from openfootball, so specials lock at the true
kickoff — but knockout **results, `underdog_team`, and ET/penalty winners stay admin-entered**
(`fb_settle_from_openfootball_json` is group-stage only); (2) a full **squads sync** for `players_catalog` — `0017` seeds a curated set of
notable current players per team so the Golden Boot / Golden Glove / Best Young Player
pickers work, but Clean Plate (per-round top scorers) and award **settlement** are still
admin-entered; (3) optionally a `football-data.org` token for
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
- **Installed today:** runtime `@supabase/supabase-js`, `react`, `react-dom`, `zod`, `@dicebear/core`, `@dicebear/collection`, `framer-motion`, `lucide-react` (icons); tooling Vite + `@vitejs/plugin-react`, Tailwind, `vitest`, `tsx`, `vite-plugin-pwa` (+ `workbox-build`/`workbox-window` kept on **7.1.x** — declared `^7.1.0`, and 7.3+ breaks the plugin's ESM `require`). See `package.json`.
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
- **RLS visibility rule:** everyone can read everything *after* lock time (it's a social game), but a pick is visible only to its owner *before* its lock time (prevents copying). Inserts/updates are own-rows-only and only before lock; `is_admin` bypasses. **Consequence for the client:** because RLS returns *all* players' picks after lock, any "my picks" read MUST filter `.eq('user_id', <me>)` itself — never rely on RLS to scope it. `fetchMyPicks`/`fetchMyRoundProps`/`fetchMyTourneyPicks` (in `api.ts`) all do; the Stadium (`fetchOutcomePickers`) and the Food Chain expand (`fetchMatchPicksForUser`) are intentionally cross-user. (This was a real bug: an unscoped read keyed into a `Map` showed a random rival's pick as "yours" once a match started — see the gotcha below.)

## Validation & testing

- Zod-validate all Edge Function inputs and external API payloads.
- The mandatory Vitest is the **decay math** — `src/lib/decay.test.ts` pins every cell of spec §4.3 (56 cases incl. group-stage bucketing and the "—" zero cells). `format.test.ts` covers display timing helpers. Authoritative scoring/locking is server-side, so it's tested at the **SQL tier** (`core_loop_test.sql` + `m2_markets_props_decay_test.sql`), never in the frontend. The SQL `fb_decay_*` helpers mirror `decay.ts`; both read `decay_schedule` so they can't drift — re-run **both** Vitest and the SQL tests after touching either.

## Commands

- `npm install` then `npm run dev` — Vite dev server (needs `.env.local`; see `.env.example`).
- `npm run build` — typecheck (`tsc --noEmit`, strict) **then** `vite build`. `npm run lint` is the typecheck alone.
- `npm test` — Vitest (`npx vitest run <path>` or `-t "<name>"` for one). Four suites:
  `decay.test.ts` (mandatory, spec §4.3), `format.test.ts` (display timing),
  `matchField.test.ts` (Match Day logic), `resultMoments.test.ts` (M4 overlay moments).
  Authoritative scoring/locking is tested at the **SQL** tier (see below), never in Vitest.
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
Edge Functions live in `supabase/functions/<name>/` (`supabase functions deploy <name>`;
`sync-fixtures` and `sync-results` exist today). Re-run the SQL acceptance test after any
migration. The real WC2026 fixtures were imported by `scripts/import-real-fixtures.mjs`
(`node scripts/import-real-fixtures.mjs > /tmp/f.sql` → pipe into the live DB); it imports group
**and** knockout fixtures (real-team matches only — re-run to add R16/QF/SF/F as their teams are
decided) and corrects each knockout round's `first_kickoff` from openfootball. `underdog_team`
stays admin-designated (powers the upset ×2 + Spice prop). `scripts/demo-matches.sql` is the demo set.

## Gotchas worth knowing

- `LANGUAGE sql` functions (e.g. `fb_is_admin`) validate their body at creation —
  define them **after** the tables they reference (plpgsql defers, sql does not).
- The pick-lock trigger intentionally allows the scorer's `points_awarded` write
  (selection/market unchanged); it blocks pick-content changes once the match **starts**
  — kickoff passed **or** status `live` — with no grace bypass (`0016`).
- **A "my picks" read must filter `user_id` explicitly — RLS does NOT scope it to you
  after lock.** Post-kickoff, `select('*')` on `match_picks`/`round_props`/`tourney_picks`
  returns *every* player's rows; if you key those into a `Map` by `match_id:market` (etc.)
  the rows collide and you render a rival's pick as the viewer's own (it looks fine for
  scheduled matches, where RLS still hides others). Always `.eq('user_id', <session user>)`
  in the `fetchMy*` helpers. The data/scorer are unaffected — this is a client-read trap.
- First-admin bootstrap: `fb_protect_profile` lets only trusted roles
  (`service_role`/`postgres`/superuser) set `is_admin`; `authenticated` users can't
  self-escalate. Don't make that trigger `SECURITY DEFINER` or `current_user` breaks.
- The local Docker DB uses `--auth-local=scram-sha-256`, so `psql` needs the
  password: `PGPASSWORD=$(cat /run/secrets/db_password) psql -U foodball -d foodball`.
- `<FoodBallMascot mood=...>` is the single mascot component, reused (not recreated) by the
  M4 result overlays — imported and rendered in `src/components/ResultOverlay.tsx`. Swap
  eyes/extras per mood (`happy|sad|spicy`); respect `prefers-reduced-motion`.
- **Tournament-pick anti-cheat** (M2): a client could otherwise forge a higher-value decay
  bucket or insert many "active" picks to guarantee a win. Two defenses: the
  `fb_enforce_tourney_pick` trigger *overwrites* `set_after_round` with the server-computed
  bucket on every insert (and enforces the revision window), and the scorer settles only the
  **latest** pick per `(user, pick_type)` — so extra inserts are just revision history, and
  `superseded_by` is for display, not authority.
- **`set_after_round` is a bucket, not a raw round.** The §4.3 "After MD1–MD3" column is one
  value, so group-stage picks store `'MD3'`; `fb_decay_bucket` / `decayBucket()` collapse
  MD1/MD2/MD3→`'MD3'` and `'F'`→`'SF'`. Keep `seed.sql`, `decay.ts`, and the SQL helpers in lockstep.
- **Keep `workbox-build` on 7.1.x** (declared `^7.1.0`; the lockfile holds the working
  build — if you bump it, stay below 7.3) — 7.3+ throws "Dynamic require of workbox-build
  is not supported" during `vite build` in this ESM project.

## Non-negotiable conventions (easy to get wrong, will break the product)

- **Never "correct" the name FoodBall to Football** anywhere — repo, code, UI, docs. The food+football pun is the entire brand. Mascot = burger-football hybrid; tagline "Predict. Feast. Repeat."; motto "Champion eats free."
- **This is NOT gambling.** No money, wallets, currency, odds, or payouts. Use "predict / pick / points" — never "bet / stake / odds".
- **$0 infrastructure** — free tiers only. Ask before adding any paid service.
- **Use the FoodBall copy vocabulary consistently** (spec §8): Leaderboard→**The Food Chain**, exact-score hit→**Full Course**, correct outcome→**Chef's Kiss**, wrong pick→**Burnt Toast**, missed pick→**Skipped Lunch**, last place→**The Leftovers zone**. The round props are **Top Chef** / **Clean Plate** / **Spice of the Round**. These strings live in one place — the `COPY` const in **`src/lib/copy.ts`** (imported across the app); import from there, don't hand-type or add a second copy.
- **The rules page ("The Menu", `src/screens/More.tsx`) reads its values from the scoring tables, never a hand-typed copy** so it can't drift. The decay grid is rendered live from `decay_schedule`; the fixed per-match/per-round point values come from `src/lib/scoring.ts` (the single TS mirror of the SQL scorer). If you change a point value, change it in `scoring.ts` *and* the SQL — don't add a third copy in the page.
- **Render a pick as a team through one helper, never inline.** An outcome `selection` is `home`/`away`/`draw`; mapping it to a team (home→`home_team`, away→`away_team`) lives only in **`pickLabel`** (`src/lib/matchField.ts`, unit-tested incl. the SWE/TUN case). Use it anywhere a pick is shown as text (Food Chain expand, etc.) so no screen can invert home/away vs the pitch/scorer. The data stores `home`/`away` consistently — never "fix" a pick by flipping the team; fix the display.
- **Reuse the mascot as one component** `<FoodBallMascot mood="happy|sad|spicy" />`, swapping eyes/extras per mood. Respect `prefers-reduced-motion` for all result-overlay animations.
- Type: the web app loads **Plus Jakarta Sans** (headings, `font-display`) + **Inter** (body, `font-body`) in `index.html`, mapped in `tailwind.config.ts`. (The spec's Luckiest Guy/Nunito survive only in the separate `recap/` Remotion package, not the app.) Palette and tokens in spec §8. Flag emoji for teams — no flag image assets.
- Secrets: frontend `.env.local` holds **only** the Supabase anon key + URL; the football-data.org token and service key are Supabase secrets, never in the frontend. Provide `.env.example`.
- If football-data.org's free tier turns out not to include WC 2026 data on first call, **say so immediately** and fall back to openfootball + manual entry rather than silently degrading.
