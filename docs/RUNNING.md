# Running FoodBall (Milestone 1)

Two ways to run, depending on what you need.

## A. Hardened local Docker run (no Supabase account needed)

Brings up the SPA behind unprivileged nginx **and** a real Postgres with the M1
schema + seed applied, so you can exercise and test the authoritative core loop.

```bash
# 1. one-time: generate the file-based DB secret
openssl rand -base64 32 | tr -d '\n' > secrets/db_password.txt && chmod 600 secrets/db_password.txt

# 2. build + start (project-namespaced so it can't collide with other stacks)
docker compose -p foodball up -d --build
```

- **App:** http://127.0.0.1:8090  (localhost-only; port chosen to avoid the
  host's existing `:4000`/`:5432`)
- **DB:** internal network only — reach it via `docker compose -p foodball exec db …`

> In this mode the SPA has no live Supabase to authenticate against, so the UI
> demonstrates the login flow but cannot complete it. The **server-side core
> loop** (RLS, locking, scoring, leaderboard) is fully real and is what the
> acceptance test exercises. For end-to-end auth in the browser, use option B.

### Run the M1 acceptance test (server tier)

```bash
docker compose -p foodball exec -T db sh -c \
  'PGPASSWORD=$(cat /run/secrets/db_password) psql -U foodball -d foodball -v ON_ERROR_STOP=1 -f /tests/core_loop_test.sql'
```

Proves: two users pick differently → allowed; pre-lock picks are hidden from
others; **a post-kickoff pick is rejected by the server** (raw SQL, UI bypassed);
non-admins can't settle results; admin result entry scores correctly incl. the
upset ×2; re-scoring is idempotent.

### <a name="verify"></a>Verify the hardening

```bash
docker inspect foodball-web-1 --format \
  'root-fs-ro={{.HostConfig.ReadonlyRootfs}} caps={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}}'
docker top foodball-web-1 -o user        # uid 101, never root
docker top foodball-db-1  -o user        # uid 70 postmaster
curl -sI http://127.0.0.1:8090/ | grep -E 'Content-Security|X-Frame|X-Content|Referrer|Permissions'
```

### Tear down

```bash
docker compose -p foodball down -v       # -v also drops the seeded DB volume
```

## B. Full stack with Supabase CLI (real auth, realtime)

For the complete browser experience (magic-link auth, live data):

```bash
npx supabase start                       # spins the Supabase stack in Docker
npx supabase db reset                    # applies migrations + supabase/seed.sql
# note the API URL + anon key it prints, then:
echo "VITE_SUPABASE_URL=http://127.0.0.1:54321"      >> .env.local
echo "VITE_SUPABASE_ANON_KEY=<printed anon key>"     >> .env.local
npm install && npm run dev               # http://127.0.0.1:5173
```

Magic-link emails are caught locally by Inbucket (the URL is printed by
`supabase start`). The Supabase CLI default ports (54321–54324) are free on this
host and don't collide with anything.

## C. Production shape

- **Frontend:** build `foodball-web:m1` (this Dockerfile) and host on Vercel/
  Netlify, or run the container behind a TLS-terminating proxy using
  `docker/nginx/foodball-tls.conf.example` (sets HSTS, modern TLS, OCSP).
- **Backend:** a hosted Supabase project (SOC 2 Type II). Apply
  `supabase/migrations/`, set the `FOOTBALL_DATA_TOKEN` + service-role key as
  **Supabase secrets**, deploy `supabase/functions/sync-fixtures`, and bootstrap
  the first admin from the dashboard SQL editor:
  `update profiles set is_admin = true where id = '<your-uuid>';`

See `docs/SECURITY.md` for the full control mapping.
