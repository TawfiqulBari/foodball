# ════════════════════════════════════════════════════════════════════════════
# FoodBall frontend — hardened multi-stage build.
# Build stage compiles the Vite SPA; runtime is unprivileged nginx serving only
# the static bundle. No source maps, no toolchain, no secrets in the final image
# (the only baked value is the PUBLIC, RLS-gated Supabase anon key).
# CIS Docker Benchmark: 4.1 non-root, 4.6 HEALTHCHECK, 4.9 COPY-not-ADD,
# 5.x runtime hardening enforced in docker-compose.yml.
# ════════════════════════════════════════════════════════════════════════════

# ── Build ───────────────────────────────────────────────────────────────────
FROM node:18.19.1-alpine AS build
WORKDIR /app

# Public client config is inlined at build time (standard for Vite SPAs).
ARG VITE_SUPABASE_URL=http://127.0.0.1:54321
ARG VITE_SUPABASE_ANON_KEY=local-anon-key
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ── Runtime ─────────────────────────────────────────────────────────────────
# nginx-unprivileged: runs as uid 101, listens on 8080, no root needed.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Hardened server config with security headers + SPA fallback.
COPY docker/nginx/foodball.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Drop the default config's listen; ours owns it. (default.conf overrides.)
EXPOSE 8080

# Liveness for orchestrators (busybox wget ships in the alpine image).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

USER 101
