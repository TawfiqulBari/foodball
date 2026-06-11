# FoodBall — Session Status

_Last updated: 2026-06-11 (live tournament session) · branch `main`_

## TL;DR

**All five milestones (M1–M5) are built and live, and the league is running on
real World Cup 2026 fixtures at https://foodball.tawfiqulbari.work.** This session
took it from demo data to the real, in-progress tournament: real fixtures, a
token-free auto-live + openfootball auto-settle pipeline, three late-launch grace
windows, a green professional theme, an in-app guide, live commentary, accurate
national-team jerseys, a live match clock, and a signup domain allowlist.
Authoritative scoring/locking still lives in Postgres; the client never computes points.

## Live deployment

**Running publicly at https://foodball.tawfiqulbari.work** (self-hosted Supabase
CLI stack on this box, single origin behind the host nginx + Let's Encrypt).
Verified end-to-end over HTTPS for a signed-in user: login, real fixtures, the live
match + clock, the leaderboard, and the grace banners.

Foundation (earlier in the build):
- Supabase CLI stack (`supabase start`) — Postgres/Auth/Realtime/Storage/Studio/Edge.
- **`0005_grants.sql`:** `anon`/`authenticated` grants that previously lived only in
  the Docker harness — now a migration so a real deploy doesn't hit "permission denied".
- **Security:** the CLI binds services to `0.0.0.0` and Docker's published ports bypass
  `ufw`, so ports `54321–54327` are dropped on the public interface via a persisted
  `DOCKER-USER` conntrack rule (`/etc/iptables/rules.v4`). nginx/localhost still reach
  them. TLS auto-renews (certbot).
- nginx vhost `foodball.conf` (single origin: SPA on `:8090`, API proxied to Kong
  `:54321`); **other vhosts/containers untouched.**

### This session (demo → live tournament)
- **Real fixtures.** `scripts/import-real-fixtures.mjs` emits idempotent SQL from
  openfootball (keyless): all **48 teams** + **72 group-stage matches** with real
  kickoff times, each group's 6 games mapped to MD1/MD2/MD3 by kickoff order; demo
  fixtures removed; round start times set from real data. Knockouts deferred (teams TBD).
- **Token-free auto-live** (`0010`): pg_cron `foodball-auto-live` (every minute) flips
  a match to `live` at its real kickoff (firing the kickoff commentary). Never
  auto-finishes — final scores stay admin/API (manual always wins).
- **Three late-launch grace windows** (admin-tunable, default until 2026-06-14 23:59
  +06; Admin → Launch tools): long shots (`0007`), round specials (`0008`), and
  per-match markets (`0011`). Match-pick grace reopens **live/upcoming** matches past
  kickoff but **never a finished one**.
- **Pick-lock hardening** (`0013`, from the 0011 adversarial audit): finished-match
  guard made unconditional; client-supplied `points_awarded` neutralized on INSERT.
- **Live commentary** (`0006`) + **atmosphere ticker** (`0012`, pg_cron
  `foodball-live-atmosphere`): real event lines (kickoff/goal/FT) plus token-free
  brand-voice colour lines for live matches (always quoting the true score).
- **Token-free auto-settle** (`0014`, pg_cron `foodball-openfootball-sync`): the in-DB
  `http` extension fetches openfootball every 10 min and settles finished group matches
  via `fb_ingest_result` (scores picks, settles round props, fires goal/FT commentary) —
  no token, no admin action. Manual results always win; pure core
  `fb_settle_from_openfootball_json(jsonb)` is unit-tested. Inert until openfootball
  publishes scores (the 2026 file is fixtures-only for now).
- **UI**: green shadcn-style theme (light/dark) + professional type/icons; first-run
  + bottom-nav **guide** (+ Remotion `guide.mp4`); accurate **home jerseys for all 48
  nations** (`src/lib/kits.ts`, incl. a Croatia checker pattern); **live match clock**
  in stadium mode; bigger/contrastier bottom nav; mobile polish.
- **Admin** (`tawfiqul.bari@infosonik.com`) — `is_admin=true`.
- **Signup lockdown** (`0015`): a server-side email-domain allowlist (BEFORE INSERT
  trigger on `auth.users`) restricts who can register — seeded with `infosonik.com`,
  admin-managed via Admin → Launch tools → "Who can sign up". Verified: a `@gmail.com`
  signup is rejected ("sign-ups are limited to approved email domains"); `@infosonik.com`
  succeeds. Fail-open if the allowlist is ever emptied.

To make yourself admin after signing up:
```bash
docker exec -i supabase_db_foodball psql -U postgres -d postgres \
  -c "update public.profiles set is_admin=true where id=(select id from auth.users where email='YOU@example.com');"
```

Caveats for the public surface:
- **Signups are gated** to an email-domain allowlist (`0015`) — seeded `infosonik.com`,
  managed in Admin → Launch tools. Safe to share the URL; add other work domains there
  as needed. (Fail-open if the allowlist is ever emptied.)
- **Live scores are automated but lag.** `foodball-auto-live` flips matches live at
  kickoff and `foodball-openfootball-sync` (`0014`) self-settles finished group matches
  from openfootball — both token-free. But openfootball's volunteer feed lags real time
  (and the 2026 file is fixtures-only until results are published), so **admin entry is
  the instant, authoritative path** (Admin → set result → goal commentary + overlays +
  scoring; always wins). A match left `live` for a while is normal — finish it by
  entering the score. A `football-data.org` token could add faster scores via
  `sync-results`, but its free tier may not cover WC2026.
- SMTP is off (password-reset email disabled; signup works).

## Milestones & commits

| Commit | Milestone | Acceptance — how it's verified |
|---|---|---|
| `2d562a5` | **M1** core loop | `supabase/tests/core_loop_test.sql` (lock rejection, pre-lock invisibility, outcome scoring + upset ×2, admin guard, idempotency) |
| `8626cef` | CLAUDE.md audit | 7 factual corrections, multi-agent reviewed |
| `b9868b0` | **M2** markets + props + decay + avatars + PWA | `decay.test.ts` (every §4.3 cell), `m2_markets_props_decay_test.sql` (revision window **rejected server-side via RPC + raw insert**, forged-bucket overwrite, decayed settlement), PWA manifest + service worker emitted by `vite build` |
| `e75d14a` | **M3** auto-sync + realtime | `m3_autosync_test.sql` (simulated API payload **settles end-to-end with no admin action**; a **manual result is never overwritten** by a later poll; rank snapshot → `rank_delta`) |
| `ecb999e` | **M4** the fun layer | `resultMoments.test.ts` (3 results → **3 sequential overlays**, dedup, kind priority); `prefers-reduced-motion` swaps to a static card |
| `4296759` | **M5** Remotion recap (optional) | rendered a valid `recap/out/recap-MD2.mp4` (1080×1920 H.264) end-to-end |

## Verification (all green at HEAD)

- `npm run lint` (`tsc --noEmit`, strict, no `any`) passes; production `web` image
  builds and is deployed.
- `npx vitest run` — **74 Vitest** across `decay.test.ts`, `resultMoments.test.ts`,
  `matchField.test.ts`, `format.test.ts`.
- **`supabase/tests/m_grace_test.sql`** (new) — runs green against the live CLI stack:
  match-pick grace ON allows a post-kickoff still-playable pick; grace OFF locks it; a
  finished match is never pickable (incl. the audited future-kickoff edge); forged
  `points_awarded` is neutralized on INSERT; client `points_awarded` UPDATE rejected;
  the three grace windows are independent.
- **`supabase/tests/m_openfootball_sync_test.sql`** (new) — a published openfootball
  score self-settles + scores a match with no admin action; a manual result is never
  overwritten. Green on the live stack.
- **Adversarial audit of `0011`/`0013`** (8-agent workflow): 2 reproduced LOW bugs,
  both fixed in `0013`; all other lenses (fairness off-path, cross-grace, NULL/idempotency,
  privilege, cascade cleanup, scorer annotation) passed.
- **Signup allowlist** (`0015`) verified on the live auth API: `@gmail.com` rejected,
  `@infosonik.com` accepted.
- **Recap** — `recap/out/recap-MD2.mp4` rendered earlier (M5).

> ⚠️ The `core_loop_test.sql` / `m2` / `m3` suites reference `SEED-*` fixtures that
> live only in the **Docker test harness** (`foodball-db-1`), whose volume is stale
> (predates `0002`) and which has no `SEED-*` rows on the CLI stack. To run them, rebuild
> the harness volume: `docker compose -p foodball down -v && docker compose -p foodball up -d --build`
> (recreates the local harness + SPA container — note it briefly restarts the live SPA).
> `0013` only *tightens* the same locks those suites assert, so no logic regression.

## How to run

```bash
# Web app (dev) — needs .env.local (Supabase anon URL + key); see .env.example
npm install && npm run dev

# Tests
npm test                       # Vitest (decay + queue + format)
npm run build                  # typecheck + production build (+ PWA)

# Hardened local Docker (app on http://127.0.0.1:8090; DB internal-only)
docker compose -p foodball up -d --build

# SQL acceptance suites (after any schema/scoring change). Swap the filename for
# m2_markets_props_decay_test.sql / m3_autosync_test.sql.
docker compose -p foodball exec -T db sh -c \
  'PGPASSWORD=$(cat /run/secrets/db_password) psql -U foodball -d foodball -v ON_ERROR_STOP=1 -f /tests/core_loop_test.sql'

# Recap MP4 (M5) — separate package
cd recap && npm install && npm run render -- --round=MD2   # → recap/out/recap-MD2.mp4
```

See `docs/RUNNING.md` (local) and `docs/DEPLOYMENT.md` (public self-host) for the
full procedures, and `CLAUDE.md` for architecture + conventions.

## Remaining

- **Live scores.** Mostly handled now: matches go live on time (`foodball-auto-live`)
  and **self-settle from openfootball** (`foodball-openfootball-sync`, `0014`) once it
  publishes a final — no token, no admin action. Two notes: openfootball's 2026 file is
  fixtures-only until volunteers add scores (lags real time, no minute-by-minute), and
  **admin entry remains the instant path** (Admin → set result → goal commentary +
  overlays immediately; always wins over openfootball). A `football-data.org` token
  could add faster/live scores via the existing `sync-results` function, but its free
  tier may not cover WC2026.
- **Knockout fixtures** — added once group standings decide the teams (the importer
  only does the 72 group games; knockout slots are placeholders in openfootball).
- **Squads sync** to populate `players_catalog` — until then Clean Plate / Top Chef /
  Golden Boot pickers are empty; Top Chef + awards settle from admin data.
- **Signups are gated** to `@infosonik.com` (`0015`) — add colleagues' other work
  domains in Admin → Launch tools → "Who can sign up" before sharing if needed.
- **Optional polish:** `lottie-react` uninstalled (M4 uses framer-motion + mascot +
  emoji confetti); the "Goals o/u 2.5" label could be reworded to "3+ goals?".

## Notes for the next session

- Migrations are additive and numbered (`0001`→`0015`); never edit an applied one in
  place. Apply new ones to the live CLI stack with
  `docker exec -i supabase_db_foodball psql -U postgres -d postgres -f -` and register
  the version in `supabase_migrations.schema_migrations`.
- **pg_cron jobs** on the live stack: `foodball-sync-results` (every 5m, inert without
  a token), `foodball-auto-live` (every 1m, token-free live flip), `foodball-live-atmosphere`
  (every 2m, brand-voice colour lines for live matches), `foodball-openfootball-sync`
  (every 10m, token-free final-score auto-settle — `0014`, needs the `http` extension).
- **Three grace windows** share one `public.settings` row (singleton). Each
  `fb_*_grace_active()` reads only its own column; admin setters are `fb_admin_set_*_grace`.
- Redeploy the SPA after frontend changes:
  `VITE_SUPABASE_URL=https://foodball.tawfiqulbari.work VITE_SUPABASE_ANON_KEY=<anon> docker compose -p foodball build web && docker compose -p foodball up -d --no-deps web`.
- TS decay (`src/lib/decay.ts`) and the SQL `fb_decay_*` helpers both read
  `decay_schedule` so they can't drift — re-run **both** Vitest and the SQL suites after
  touching either.
- `vite-plugin-pwa` requires `workbox-build` pinned to `7.1.0` (7.3+ breaks its ESM `require`).
