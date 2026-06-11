# Build Spec: "FoodBall" — FIFA World Cup 2026 Office Prediction League

> **How to use this file:** Place it in the root of an empty git repository as `SPEC.md`, start Claude Code, and say: *"Read SPEC.md and build Milestone 1. Follow the working agreements at the bottom."* Build milestone by milestone, verifying each acceptance checklist before moving on.

---

## 1. Project overview

**The app is named "FoodBall" — a deliberate pun (food + football). The winner literally eats free.** The entire brand voice leans into this joke: the mascot is a burger-football hybrid with cartoon eyes, the tagline is "Predict. Feast. Repeat.", and the league motto is "Champion eats free." Every piece of UI copy should taste like the pun — see the copy guide in §8. Never "correct" the name to Football anywhere in the app, repo, or docs.

A points-based prediction league web app for ~20–50 colleagues at one company. Players predict match outcomes and tournament events for the FIFA World Cup 2026 (June 11 – July 19, 2026; 48 teams, 12 groups, 104 matches, knockout from Round of 32). Correct predictions earn points; a live leaderboard ranks everyone; top finishers win a real-world office prize.

**This is NOT gambling.** No money is staked anywhere in the app. Points only. Do not implement wallets, currency, odds-based payouts, or anything resembling wagering. Use the language "predict / pick / points" everywhere, never "bet / stake / odds".

**Hard constraints:**
- Total infrastructure cost: $0 (free tiers only).
- Mobile-first. Most users will play on phones. Must also look good on desktop.
- Lifespan: ~6 weeks of intense use, then archival. Optimize for speed of delivery and fun, not enterprise longevity.
- Tone: playful, cartoonish, office-banter energy.

## 2. Tech stack

- **Frontend:** Vite + React 18 + TypeScript + Tailwind CSS. PWA via `vite-plugin-pwa` (installable, offline shell, app icon).
- **Animation:** `framer-motion` for UI/avatar motion, `lottie-react` for celebration/loss animations (use free LottieFiles JSON assets, bundle them locally in `/src/assets/lottie/`).
- **Avatars:** DiceBear (`@dicebear/core` + `@dicebear/collection`, generated client-side as SVG — no external image requests). Style: `adventurer` or `big-smile` (cartoonish). Seed from user's display name; allow customization (hair, skin, accessories, background color) stored as JSON in the user profile.
- **Backend:** Supabase free tier — Postgres, Auth (email magic link), Realtime (live leaderboard), Edge Functions (results sync + scoring), `pg_cron` (scheduled polling).
- **Hosting:** Vercel or Netlify free tier for the frontend. Supabase hosts everything else.
- **Results data:** football-data.org API (free tier includes the World Cup, competition code `WC`, 10 calls/minute) as primary source. Fallback #1: openfootball `worldcup.json` (free, no key, https://github.com/openfootball/worldcup.json — updated roughly daily, not live). Fallback #2: manual admin entry, which must always work even if both APIs die.
- **Recap videos (Milestone 5, optional):** Remotion in a separate `/recap` package — renders a weekly leaderboard-recap MP4 from JSON. Not part of the web app runtime.

## 3. Tournament structure and rounds

The app's "round" concept drives pick-locking and revision windows:

| Round key | Name | Window (2026) |
|---|---|---|
| `MD1` | Group Matchday 1 | Jun 11–17 |
| `MD2` | Group Matchday 2 | Jun 18–23 |
| `MD3` | Group Matchday 3 | Jun 24–27 |
| `R32` | Round of 32 | Jun 28 – Jul 3 |
| `R16` | Round of 16 | Jul 4–7 |
| `QF` | Quarter-finals | Jul 9–11 |
| `SF` | Semi-finals | Jul 14–15 |
| `F` | Third place + Final | Jul 18–19 |

Exact dates/fixtures must be seeded from the API at setup time, not hardcoded (only the round keys above are fixed). A round is "complete" when all its matches have final results.

## 4. Game rules and scoring

### 4.1 Per-match predictions (lock at each match's kickoff)

| Market | Points |
|---|---|
| Match outcome (home/draw/away — draw only exists in group stage; knockout = winner after ET/pens) | 10 |
| Exact final score (90 min for groups; after ET for knockouts, pens excluded from score) | +25 bonus on top of outcome points |
| Both teams to score (yes/no) | 5 |
| Total goals over/under 2.5 | 5 |
| Upset multiplier: if the player picked the designated underdog to win and it wins, the outcome points double (10 → 20) | ×2 on outcome |

The "underdog" per match is set by the admin (default: lower FIFA-ranked team; store FIFA rank per team at seed time).

### 4.2 Per-round props (lock at first kickoff of the round, settle when round completes)

| Prop | Points |
|---|---|
| **Top Chef** — top scorer of the round (player who scores most goals in that round; ties: all picks of tied players win) | 15 |
| **Clean Plate** — clean-sheet keeper (pick one goalkeeper; points if their team keeps a clean sheet in any match that round) | 10 |
| **Spice of the Round** — upset of the round (pick one match where the underdog wins) | 20 |

### 4.3 Tournament-long predictions (revisable between rounds, with point decay)

Players set these before the tournament and may revise after any round completes. Points awarded are determined by **when the currently-held pick was last set**:

| Pick | Before MD1 | After MD1–MD3 | After R32 | After R16 | After QF | After SF |
|---|---|---|---|---|---|---|
| Champion | 100 | 70 | 50 | 35 | 20 | 10 |
| Both finalists (each) | 40 | 30 | 20 | 15 | 8 | — |
| Golden Boot (top scorer) | 50 | 35 | 25 | 18 | 10 | 5 |
| Golden Glove (best keeper) | 40 | 28 | 20 | 14 | 8 | 4 |
| Best Young Player | 30 | 20 | 15 | 10 | 6 | 3 |
| Total tournament goals (within ±5 of actual) | 30 | 20 | — | — | — | — |

Keep this as a `decay_schedule` table in the DB so the admin can tune values without code changes. Store full revision history (every change with timestamp) — show it on the profile ("loyalty badge" if a player never switched their champion).

### 4.4 Locking, switching, anti-cheat

- A pick is immutable from the moment its lock time passes. Enforce server-side (Postgres RLS + a `locked_at` check in a `before insert/update` trigger comparing against the match/round kickoff stored in the DB) — never trust the client clock.
- Missed picks score 0; no penalties. Send no shame, just a nudge notification.
- Tournament-long picks can only be changed in the window between a round completing and the next round's first kickoff.

### 4.5 Tie-breakers for final standings

1. Total points → 2. Most exact-score hits → 3. Most correct outcomes → 4. Earliest-set correct champion pick → 5. Coin flip animated in the app (a spinning football, seeded random, admin-triggered, recorded).

## 5. Data model (Postgres / Supabase)

```sql
profiles        (id uuid PK refs auth.users, display_name, avatar_config jsonb,
                 is_admin bool default false, created_at)
teams           (id, name, fifa_code, fifa_rank int, group_letter, flag_emoji)
rounds          (key text PK, name, first_kickoff timestamptz, completed bool)
matches         (id, api_match_id text unique, round_key refs rounds, group_letter,
                 home_team refs teams, away_team refs teams, kickoff timestamptz,
                 underdog_team refs teams null, status text, -- scheduled|live|finished
                 home_score int null, away_score int null,
                 home_score_et int null, away_score_et int null,
                 winner refs teams null, result_source text) -- api|manual
players_catalog (id, name, team refs teams, position text)   -- for prop picks, seeded from API squads
match_picks     (id, user_id, match_id, market text, selection text,
                 created_at, points_awarded int null,
                 unique(user_id, match_id, market))
round_props     (id, user_id, round_key, prop text, selection text,
                 created_at, points_awarded int null,
                 unique(user_id, round_key, prop))
tourney_picks   (id, user_id, pick_type text, selection text,
                 set_after_round text null,  -- null = pre-tournament
                 superseded_by uuid null,    -- revision chain
                 created_at, points_awarded int null)
decay_schedule  (pick_type, set_after_round, points int)
score_events    (id, user_id, source_table, source_id, points, reason text, created_at)
leaderboard     -- materialized view over score_events, refreshed by scoring fn,
                -- exposing rank, total, exact_hits, outcome_hits, rank_delta vs previous round
```

**RLS:** users read everything (it's a social game — everyone's picks become visible after lock time, hidden before), but can insert/update only their own rows and only before lock. Admin role bypasses via `is_admin`. Picks before lock time are visible only to their owner (prevents copying).

## 6. Results sync (Edge Functions)

1. `sync-fixtures` — run once at setup + daily: pulls the full WC fixture list and squads from football-data.org, upserts `teams`, `matches`, `players_catalog`. Idempotent by `api_match_id`.
2. `sync-results` — `pg_cron` every 5 minutes, but only inside match windows (any match with kickoff < now < kickoff + 3.5h, or status = live): fetches scores, updates `matches`, and when a match flips to `finished`, calls the scoring function. Respect the 10 calls/minute limit — one call fetches all matches for the competition, so a single request per poll is enough.
3. `score-match(match_id)` — Postgres function: settles all `match_picks` for that match, writes `score_events`, refreshes `leaderboard`. When the last match of a round finishes, also settle `round_props`, mark the round complete, and open the tournament-pick revision window.
4. `score-tournament` — runs when QF/SF/F results land: settles finalists, champion, and (after the final, with golden boot/glove entered by admin since the free API may not expose award data) all remaining tournament picks using `decay_schedule`.
5. **Manual override:** the admin panel writes the same columns with `result_source='manual'`; manual always wins over API (sync skips matches already finalized manually).

Store the football-data.org token as a Supabase secret (`FOOTBALL_DATA_TOKEN`), never in the frontend.

## 7. Screens (mobile-first; bottom tab nav: Matches · Leaderboard · My picks · More)

1. **Onboarding** — magic-link email sign-in; first login forces display name + avatar builder (randomize button + 4–5 sliders/option rows for hair, skin, expression, accessory, bg color; live preview; big "That's me!" confirm).
2. **Matches (home)** — horizontal round selector chips (current round default); match cards grouped by day: flags, teams, kickoff in local time, countdown-to-lock badge; tap to expand pick controls (outcome segmented control, exact-score steppers, BTTS + over/under toggles); upset matches show a small "underdog ×2" tag; live matches show score pulse; finished matches show result + points earned with green/red chips. Round props in a card at the top of each round view.
3. **Leaderboard ("The Food Chain")** — realtime; rank, avatar, name, total, rank-change arrow since last round; podium top-3 with larger avatars (gold/silver/bronze dinner plates under them); tapping a player (after lock) opens their picks read-only; "rivals" pin — star up to 3 colleagues to see them stuck under your own row.
4. **My picks** — tournament-long picks with current decayed value shown ("Champion: Argentina — worth 70 pts if correct"); revision window banner when open; revision history timeline; per-round pick summary and points breakdown from `score_events`.
5. **Match result moment (the fun layer)** — when results land while the app is open (Realtime event) or on next open: full-screen takeover, ~2.5s, skippable. Correct pick → user's avatar bounces in (framer-motion spring) over a confetti/trophy Lottie with "CHEF'S KISS! +10"; exact score hit → bigger "FULL COURSE! +35" with fireworks and flying-food confetti (burgers, fries, samosas as small SVG particles); upset double → "SPICY PICK! ×2" with a chili shake; wrong pick → avatar slumps under a raincloud Lottie next to a piece of burnt toast with a gentle "Burnt toast. Next match, chef." Queue multiple results, never stack overlays. Respect `prefers-reduced-motion`.
6. **Admin (route-guarded by `is_admin`)** — manual result entry per match, underdog assignment, round-complete override, golden boot/glove/young player entry, decay table editor, force leaderboard refresh, sync logs viewer.
7. **More** — rules page titled "The Menu" (auto-generated from the scoring tables so it never drifts from code), prize card with the badge logo and "Champion eats free" headline (admin-editable description of the actual prize, e.g. the winner's team lunch), install-as-app instructions, sign out.

## 8. Design direction and FoodBall brand

- **Logo assets (provided in `/branding/`, committed to the repo):** `foodball-badge.svg` (full crest — splash screen, rules page, recap videos), `foodball-icon.svg` (burger-ball on navy rounded square — PWA icon, favicon; export 192/512px maskable PNGs), `foodball-wordmark.svg` (header logo where the first O of FOODBALL is the burger-ball; tagline "Predict. Feast. Repeat."). Mascot anatomy: top half = sesame bun with cartoon eyes and blush, middle stripes = lettuce/tomato/patty, bottom half = classic football pentagons. Reuse the mascot SVG as a component (`<FoodBallMascot mood="happy|sad|spicy" />`) — swap the eyes/extras per mood for the result overlays.
- **Display font:** Luckiest Guy (Google Fonts) for headings, points, and celebration text — it matches the logo. Body: Nunito or system sans.
- Palette: deep navy `#0A2540` base, teal `#1C7293`, cyan `#17A2C4` accents, bun-gold `#F2A93B` and warm yellow `#FFC857` for points/celebration moments, lettuce green `#7CC243` for success states, tomato red `#E2504C` for misses. Dark-on-light cards, generous radius (16px), chunky tap targets (min 44px).
- **Copy guide (apply consistently, keep it light, never at a player's expense beyond gentle banter):**

| Standard term | FoodBall term |
|---|---|
| Leaderboard | **The Food Chain** |
| Top scorer of the round prop | **Top Chef** |
| Clean-sheet keeper prop | **Clean Plate** |
| Upset of the round prop | **Spice of the Round** |
| Exact score hit | **Full Course** |
| Correct outcome | **Chef's Kiss** |
| Wrong pick | **Burnt Toast** |
| Missed picks (didn't submit) | **Skipped Lunch** |
| Last place on leaderboard | **The Leftovers zone** (gentle, with a fork-and-knife icon) |
| Prize banner | **"Champion eats free"** |
| Empty states | Food jokes, e.g. "No matches cooking today. Marinate your picks for tomorrow." |

- Flag emoji for teams (no flag image assets needed).
- Micro-interactions everywhere: pick buttons spring on tap, points count up with a ticker, leaderboard rows animate position changes with framer-motion `layout`. The wordmark's burger-ball eye pupils follow the cursor/last touch point on desktop and tilt on mobile (device orientation, subtle, optional).
- PWA manifest: `name: "FoodBall"`, `short_name: "FoodBall"`, `theme_color: "#0A2540"`, `background_color: "#0A2540"`, icons from `foodball-icon.svg` exports.

## 9. Milestones (build in order; each must pass its checklist before the next)

**M1 — Core loop (target: 2 days).** Supabase schema + RLS, magic-link auth, fixture seed from API, Matches screen with outcome picks only, server-side lock enforcement, manual admin result entry, scoring for outcome market, basic leaderboard.
✅ Two test users can register, pick differently on a match, admin enters a result, leaderboard updates correctly, and a pick after kickoff is rejected by the server even if the client UI is bypassed (test with a raw REST call).

**M2 — Full markets + avatars.** Exact score, BTTS, over/under, upset multiplier, round props, tournament-long picks with decay + revision windows + history. Avatar builder, avatars on leaderboard. PWA install.
✅ Decay math verified against the table in §4.3 with unit tests; revision outside an open window is rejected server-side; app installs to an Android/iOS home screen.

**M3 — Auto-sync + realtime.** `sync-results` cron, live score display, Realtime leaderboard, manual-override precedence.
✅ Simulated API payload settles a match end-to-end with no admin action; manual result entered first is not overwritten by a later API poll.

**M4 — The fun layer.** Result-moment overlays (win/exact/loss variants), Lottie assets bundled, queueing, reduced-motion support, podium animations, rivals pinning, rank-change arrows.
✅ A batch of 3 results plays 3 sequential overlays without overlap; `prefers-reduced-motion` swaps animations for static cards.

**M5 (optional) — Remotion recap.** `/recap` package: `npm run render -- --round=MD2` pulls leaderboard JSON via Supabase service key and renders a 30–45s vertical MP4 (9:16, office-WhatsApp-friendly): round headline, top-3 podium with avatars, biggest climber, biggest faller, upset survivor count.
✅ Renders locally to `out/recap-MD2.mp4` under 60s of render time per minute of video on a laptop.

## 10. Working agreements for Claude Code

- TypeScript strict mode; no `any`. Zod-validate all Edge Function inputs and API payloads.
- All scoring logic lives in Postgres functions or Edge Functions — the client never computes authoritative points.
- Write unit tests for the scoring engine and decay math (Vitest); these are the only mandatory tests.
- Seed script (`npm run seed:demo`) creates 8 fake users with avatars and randomized picks so screens are never empty during development.
- Keep secrets in `.env.local` (frontend: only the Supabase anon key + URL) and Supabase secrets (API token, service key). Provide `.env.example`.
- Commit per milestone with a summary of checklist results. Ask before adding any paid service or any dependency beyond those named in §2.
- If football-data.org free tier turns out not to include WC 2026 match data when you first call it, say so immediately and fall back to openfootball JSON polling (30-min interval) + manual entry rather than silently degrading.
