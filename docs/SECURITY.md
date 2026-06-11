# FoodBall — Security & Hardening Baseline

This document maps FoodBall's **implemented** technical controls to the
**CIS Docker Benchmark**, **NIST SP 800-53 / 800-190**, and the **SOC 2** Trust
Services Criteria. It is scoped to Milestone 1 and grows with each milestone.

> **Honest framing.** "SOC 2" is an organizational attestation earned through an
> audit of operating effectiveness over time — code alone cannot *be* SOC 2.
> What this repo provides is the **technical control surface** that supports the
> relevant criteria, plus a managed backend (**Supabase**, which is itself **SOC 2
> Type II** and HIPAA-capable) so the data store, auth, and network controls sit
> on an audited platform. The items below are the controls we own in this repo.

---

## 1. Architecture & trust boundaries

```
 Browser (PWA)  ──TLS──▶  Reverse proxy / platform  ──▶  nginx (static SPA, uid 101, read-only)
      │                                                    └ no app secrets; anon key only
      └──────── HTTPS/WSS ────────▶  Supabase (Postgres + Auth + PostgREST + Realtime)
                                          └ RLS + triggers = the authorization & locking authority
```

- **The client is never trusted for authorization or scoring.** All locking and
  point computation live in Postgres functions/triggers (`fb_enforce_match_pick_lock`,
  `fb_score_match`) and Row Level Security. The browser holds only the **public,
  RLS-gated anon key**.
- **Defense in depth:** even if the SPA is fully bypassed (raw REST/SQL), the
  database rejects post-kickoff picks, hides pre-lock picks, and blocks
  privilege escalation. This is proven by `supabase/tests/core_loop_test.sql`.

---

## 2. Container hardening — CIS Docker Benchmark

Verified live with `docker inspect` / `docker top` (see `docs/RUNNING.md §verify`).

| CIS item | Control | Where |
|---|---|---|
| 4.1 Run as non-root | web → uid **101**; Postgres postmaster → uid **70**; no process runs as root | `Dockerfile` (`USER 101`, `nginx-unprivileged`), verified via `docker top` |
| 4.6 Add HEALTHCHECK | `wget /healthz` (web), `pg_isready` (db) | `Dockerfile`, `docker-compose.yml` |
| 4.9 Use COPY not ADD | only `COPY` used | `Dockerfile` |
| 4.10 No secrets in image | multi-stage build; `.dockerignore` excludes `secrets/`, `.env*`, keys; only the **public** anon key is baked | `Dockerfile`, `.dockerignore` |
| 5.3 Drop Linux capabilities | `cap_drop: [ALL]`; web adds **none**; db adds only `CHOWN,DAC_OVERRIDE,FOWNER,SETGID,SETUID` (entrypoint minimum) | `docker-compose.yml` |
| 5.12 Read-only root filesystem | `read_only: true` + tmpfs for `/tmp`,`/var/cache/nginx`,`/run`; writes blocked (verified) | `docker-compose.yml` |
| 5.25 Restrict new privileges | `security_opt: [no-new-privileges:true]` | `docker-compose.yml` |
| 5.28 PID limit | `pids_limit` (web 100 / db 200) | `docker-compose.yml` |
| 5.10/5.11 Memory & CPU limits | `mem_limit`, `cpus` per service | `docker-compose.yml` |
| 5.7 Don't expose unneeded ports | DB has **no** host port; web bound to `127.0.0.1:8090` only | `docker-compose.yml` |
| 5.29 No default bridge | dedicated `frontend` / `backend` networks; `backend` is `internal: true` | `docker-compose.yml` |
| Logging | `json-file` with size+file rotation | `docker-compose.yml` |

**NIST SP 800-190** (Application Container Security): least-privilege runtime
(§4.3), image minimization & provenance (§4.1, pinned base tags + digests
resolved at build), and network segmentation (§4.4) are addressed by the above.

---

## 3. Network & transport — nginx

| Control | Detail | File |
|---|---|---|
| Security headers | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy` (all features off) | `docker/nginx/foodball.conf` |
| Content-Security-Policy | `default-src 'self'`; `object-src 'none'`; `frame-ancestors 'none'`; scripts `'self'`; connect limited to Supabase origins | same |
| add_header inheritance | **all** headers declared at *server* scope; no `location` overrides them (the classic nginx drop pitfall is avoided) | same |
| Version disclosure | `server_tokens off` | same |
| Request limits | `client_max_body_size 1m`; `limit_req` rate zone | same |
| Dotfile protection | `location ~ /\. { deny all; }` | same |
| TLS | terminate at the platform/proxy; hardened template (TLS1.2/1.3, HSTS preload, OCSP) provided | `docker/nginx/foodball-tls.conf.example` |

> **CSP residual:** `style-src` allows `'unsafe-inline'` (React inline styles +
> Google Fonts) — a known, accepted residual. To remove it, self-host the fonts
> and migrate inline styles to classes, then drop `'unsafe-inline'`.

---

## 4. Identity, authorization, data — NIST 800-53 / SOC 2 CC6

| Criterion | Control | Where |
|---|---|---|
| AC-3 / CC6.1 Logical access | **Row Level Security** on every user table; reads gated, writes own-row-only | `0001_init.sql` (RLS policies) |
| AC-3 Anti-copying | a pick is visible to others **only after kickoff**; owner sees own anytime | `match_picks_read` policy |
| AC-6 Least privilege | reference data writable only by admins; scoring fns **not** client-callable; admin RPCs self-check `fb_is_admin()` | grants + `fb_admin_*` |
| AC-6(5) Priv. escalation | `is_admin` cannot be self-granted by `authenticated`/`anon`; only trusted roles bootstrap admins | `fb_protect_profile` trigger |
| SC-8 / CC6.7 In-transit | HTTPS/WSS to Supabase; TLS at the proxy | nginx + Supabase |
| IA-5 / CC6.1 Secrets | frontend holds only the public anon key; service-role key & football-data token are server-only; file-based Docker secrets; **fail-fast** if config missing (no hardcoded fallback) | `.env.example`, `src/lib/supabase.ts`, `secrets/` |
| SI-10 Input validation | Zod-validated auth input (client) and Edge Function / external API payloads | `Login.tsx`, `Admin.tsx`, `sync-fixtures` |
| SI-11 Error handling | user-facing errors carry no stack traces; prod build ships **no source maps** | `vite.config.ts`, screens |
| AU-2 / CC7.2 Audit trail | append-only `score_events` ledger (one row per scored pick, idempotent) | `score_events`, `fb_score_match` |

---

## 5. Secrets management

- **Nothing secret is committed.** `.gitignore` covers `.env*`, `secrets/*`,
  keys/certs; `.dockerignore` keeps them out of the build context.
- **Runtime injection:** the DB password is a **file-based Docker secret**
  (`POSTGRES_PASSWORD_FILE`), never an env literal — it does not appear in
  `docker inspect`, the image, the compose file, or shell history.
- **Fail-fast:** `src/lib/supabase.ts` throws at startup if config is absent
  rather than silently using a placeholder (the security-hardening "no secret
  fallbacks" rule).
- **Rotation:** regenerate `secrets/db_password.txt` and recreate the `db`
  service; rotate the Supabase keys / football-data token in their dashboards.

Audit any time with the bundled scanner:
```bash
/root/.claude/skills/security-hardening/scripts/audit-secrets.sh .
```

---

## 5a. Adversarial review (2026-06-11) — findings & fixes

An independent multi-agent review (4 dimensions, each finding adversarially
verified) confirmed **0 critical, 0 high, 3 medium, 6 low**. Fixed in this commit:

| Sev | Finding | Fix |
|---|---|---|
| medium | A user could write their own `match_picks.points_awarded` (the lock trigger whitelisted it) | Lock trigger now rejects `points_awarded` changes from `authenticated`/`anon`; only the SECURITY DEFINER scorer / service role may write it. Test step 8. |
| medium | `sync-fixtures` made service-role writes with no caller authz | Now requires an admin JWT or a constant-time cron-secret header; `config.toml` pins `verify_jwt = true`. |
| medium | `sync-fixtures` hardcoded `round_key='MD1'` / no squads | Derives the round from the API stage; team-create + `players_catalog` explicitly scoped to a later milestone (no silent mislabeling). |
| low | `profiles` INSERT path could set `is_admin=true` | INSERT policy now `with check (... and is_admin = false)`, mirroring the UPDATE guard. |
| low | A pick row could be re-pointed to another match (mutating `created_at` semantics) | Trigger now makes `match_id` immutable on UPDATE (re-picks = delete+insert). |
| low | Seed used `ALTER TABLE … DISABLE TRIGGER` (persists if seed aborts) | Switched to session-scoped `session_replication_role = replica`. |

Accepted as low / deferred: digest-pin base images (tags are version-pinned;
pin `@sha256` in CI); add COEP (would break cross-origin Google Fonts — left off
intentionally); drop the Edge Function's residual `any` (response-envelope shape
only; inner data is Zod-validated).

## 6. Known residuals / follow-ups

- **2FA (TOTP):** auth is Supabase magic-link for M1; Supabase MFA can be
  enabled later (out of M1 scope).
- **Rate limiting** beyond nginx's request zone (per-endpoint login/API limits)
  is handled by Supabase Auth; tune if self-hosting.
- **CSP `style-src 'unsafe-inline'`** — see §3 residual.
- **Image digest pinning** — base tags are pinned (`node:18.19.1-alpine`,
  `nginx-unprivileged:1.27-alpine`, `postgres:16-alpine`); pin by `@sha256:`
  digest in CI for full immutability.
- **Postgres `db` runs its entrypoint as root** before dropping to uid 70 (the
  official image's model). To start fully rootless, pre-create and chown the
  data volume and set `user: "70:70"`.
