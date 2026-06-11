# FoodBall Recap (`/recap`) — Milestone 5

A **separate** Remotion package (not part of the web-app runtime, spec §2/§9 M5)
that renders a 30–45s vertical (9:16) MP4 round recap for office WhatsApp: round
headline → top-3 podium with avatars → biggest climber / biggest faller → climbers
count → "Champion eats free" outro.

## Render

```bash
cd recap
npm install                 # pulls Remotion (+ its headless Chromium on first render)
npm run render -- --round=MD2
# → recap/out/recap-MD2.mp4
```

- **Live data:** set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the service key
  is read here only, server-side — never in the web app). The renderer pulls
  `leaderboard` (rank, total, `rank_delta`, `avatar_config`) for the round.
- **Offline / demo:** with no Supabase env set, it renders baked demo data, so the
  pipeline is verifiable without a backend.
- **Preview live:** `npm run studio` opens the Remotion studio.

Avatars are rendered to data URIs with the same DiceBear style as the app
(`adventurer`, seeded from display name), so the recap matches the leaderboard.

## Acceptance (spec §9 M5)

Renders locally to `out/recap-<round>.mp4` in well under 60s of render time per
minute of video on a laptop. (35s video target.)
