# FoodBall — Public Self-Host Go-Live Runbook

Goal: colleagues sign in (email + password) over **HTTPS at your domain**, with a
self-hosted Supabase backend on this server (`217.216.111.196`). The existing
host nginx fronts everything as a single origin behind a Let's Encrypt cert.

```
 Browser ──HTTPS──▶ host nginx (TLS, :443)
                       ├── /                  → foodball-web container (SPA, 127.0.0.1:8090)
                       └── /auth|rest|realtime/v1/ → Supabase CLI gateway (127.0.0.1:54321)
                                                        └── GoTrue + PostgREST + Postgres (RLS)
```

## What I still need from you (2 things)

1. **The exact hostname** you pointed at `217.216.111.196` in Cloudflare
   (e.g. `foodball.infosonik.com`). I auto-detect proxied vs DNS-only and adapt
   the cert step.
2. **The Gmail app password** for your infosonik.com sender — paste it once and
   I drop it into `secrets/smtp_password.txt` (gitignored, never committed).
   With email+password + `enable_confirmations=false`, SMTP is only used for
   password resets, so sign-up works even before this is set.

## Steps (run on the server)

```bash
# 0) backend secret for the SMTP sender (gitignored)
printf '%s' 'XXXX XXXX XXXX XXXX' > secrets/smtp_password.txt && chmod 600 secrets/smtp_password.txt
export GOTRUE_SMTP_PASS="$(cat secrets/smtp_password.txt)"

# 1) Supabase CLI (self-hosted stack, runs in Docker on this box)
npm i -D supabase
# edit supabase/config.toml: set site_url + additional_redirect_urls to
#   https://HOSTNAME, and the two SMTP user/admin_email to your infosonik address
npx supabase start                 # prints API URL (…:54321) + the anon key
npx supabase db reset              # applies migrations/0001_init.sql + seed.sql (reference data)

# 2) Build the SPA against the public origin + that anon key, then (re)start the container
docker compose -p foodball build \
  --build-arg VITE_SUPABASE_URL=https://HOSTNAME \
  --build-arg VITE_SUPABASE_ANON_KEY=<anon key from step 1> web
docker compose -p foodball up -d web      # SPA now on 127.0.0.1:8090

# 3) Public vhost + TLS (host nginx)
sudo cp docker/nginx/foodball-public.conf.example /etc/nginx/sites-available/foodball.conf
sudo sed -i 's/HOSTNAME/your.host.name/g' /etc/nginx/sites-available/foodball.conf
sudo ln -s /etc/nginx/sites-available/foodball.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d your.host.name     # issue + wire the cert
sudo nginx -t && sudo systemctl reload nginx

# 4) Make yourself the admin (after you sign up once in the app)
npx supabase db reset >/dev/null 2>&1 || true   # (only if you want a clean DB)
# then, after signing up at https://HOSTNAME:
#   psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2-)" \
#     -c "update public.profiles set is_admin=true where id=(select id from auth.users where email='you@infosonik.com');"
```

## Firewall / Cloudflare

- Inbound **80 + 443** must reach the box (they already listen publicly here).
  If a cloud security group fronts the server, allow 80/443.
- Keep the Supabase ports (54321–54323) and `:8090` **localhost-only** — only the
  host nginx should reach them. Do not publish them publicly.
- **Cloudflare proxied (orange) record:** certbot HTTP-01 can be intercepted. Set
  the record to DNS-only for issuance, or use a Cloudflare Origin Certificate with
  SSL mode "Full (strict)". DNS-only (grey) → certbot works as written.

## Security notes for the public surface

- RLS is the authorization boundary; the anon key is public and RLS-gated.
- Single origin means the SPA's CSP `connect-src 'self'` already covers the API.
- `verify_jwt = true` on the Edge Function; it also self-checks admin / cron secret.
- Rotate: regenerate the SMTP app password in Google, update `secrets/smtp_password.txt`,
  re-export `GOTRUE_SMTP_PASS`, `npx supabase stop && npx supabase start`.

See `docs/SECURITY.md` for the full control mapping.
