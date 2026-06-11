# FoodBall — Session Status

_Last updated: 2026-06-11 · branch `main`_

## TL;DR

**All five milestones (M1–M5) are built and their spec §9 acceptance checklists
pass.** The product is feature-complete; what remains is **deploy wiring**, not
features (see "Remaining" below). Authoritative scoring/locking lives in Postgres;
the client never computes points.

## Live deployment

**Running publicly at https://foodball.tawfiqulbari.work** (self-hosted Supabase
CLI stack on this box, single origin behind the host nginx + Let's Encrypt).
Verified end-to-end over HTTPS: signup/login (no email confirmation), Matches (5
demo fixtures), the leaderboard view, and reference data all load for a signed-in
user.

What this session set up:
- Supabase CLI stack (`supabase start`) — Postgres/Auth/Realtime/Storage/Studio/
  Edge — with migrations `0001`–`0005` + `seed.sql` applied.
- **`0005_grants.sql` (real bug fix):** the `anon`/`authenticated` table grants
  previously lived only in the Docker harness (`02_grants.sql`), so a real Supabase
  deploy hit "permission denied". Now a committed migration — applies everywhere.
- **Security:** the Supabase CLI binds services to `0.0.0.0`; Docker's published
  ports bypass `ufw`, so ports `54321–54327` are dropped on the public interface via
  a persisted `DOCKER-USER` conntrack rule (`/etc/iptables/rules.v4`). nginx/localhost
  still reach them. TLS cert auto-renews (certbot).
- nginx vhost `foodball.conf` added (single origin: SPA on `:8090`, API proxied to
  Kong `:54321`); **your other vhosts/containers were not touched.**
- 5 demo MD1 fixtures inserted (`scripts/demo-matches.sql`, re-runnable).

To make yourself admin after signing up:
```bash
docker exec -i supabase_db_foodball psql -U postgres -d postgres \
  -c "update public.profiles set is_admin=true where id=(select id from auth.users where email='YOU@example.com');"
```

Caveats for the public surface:
- **Signups are open** (`enable_signup = true`) — anyone with the URL can register.
  Lock down (disable signups once colleagues join, or add a domain allowlist) before
  sharing widely.
- The `sync-results` cron is scheduled (0004) but **inert** here: the function isn't
  deployed and `FOOTBALL_DATA_TOKEN` / Vault secrets aren't set, so fixtures are
  demo/admin-entered for now. SMTP is off (password-reset email disabled; signup works).

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

- `npm run build` — `tsc --noEmit` (strict, no `any`) + `vite build` + PWA SW (21 precache entries).
- `npm test` — **65 Vitest** across `decay.test.ts`, `resultMoments.test.ts`, `format.test.ts`.
- **SQL acceptance** on a fresh Dockerized Postgres — M1 + M2 + M3 suites all pass.
- **Recap** — `recap/out/recap-MD2.mp4` rendered (data → DiceBear avatars → bundle → headless render).

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

## Remaining (deploy wiring, not features)

- **`pg_cron` schedule** for `sync-results` — now wired as migration
  `0004_sync_results_cron.sql` (window-aware, secrets from Supabase Vault). It runs
  only on a Supabase DB (pg_cron/pg_net/Vault), not the local stock-postgres harness.
  To activate: deploy the function, set the `project_url` + `sync_secret` Vault
  secrets, and `supabase migration up` — full runbook in `docs/DEPLOYMENT.md §5`.
- **Squads sync** to populate `players_catalog` — until then the Clean Plate / Top
  Chef / Golden Boot pickers are empty, and Top Chef + tournament awards settle from
  **admin-entered** data. Tournament settlement (champion/finalists/awards) and
  knockout ET/penalty winners are admin-entered by design (manual always wins).
- **Manual checks worth doing before go-live:** PWA install on a real Android/iOS
  device; the live `football-data.org` WC-2026 feed (spec §10 — no API token in this
  environment; the openfootball + manual-entry fallbacks always work regardless).
- **Optional polish:** `lottie-react` is uninstalled — M4 celebrations use
  framer-motion + the mascot + emoji confetti; drop in LottieFiles JSON later if wanted.

## Notes for the next session

- Migrations are additive and numbered (`0001`→`0003`); never edit an applied one
  in place. Local Docker mounts them as `01_init` / `01b_m2` / `01c_m3` before
  `02_grants` (see `docker-compose.yml`).
- TS decay (`src/lib/decay.ts`) and the SQL `fb_decay_*` helpers both read
  `decay_schedule` so they can't drift — re-run **both** Vitest and the SQL suites
  after touching either.
- `vite-plugin-pwa` requires `workbox-build` pinned to `7.1.0` (7.3+ breaks its ESM `require`).
