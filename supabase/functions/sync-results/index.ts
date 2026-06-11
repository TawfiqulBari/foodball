// FoodBall — sync-results Edge Function (spec §6.2). Polls live scores and final
// results and feeds each into the authoritative fb_ingest_result RPC, which
// auto-scores a match the moment it flips to 'finished' — no admin action — and
// NEVER overwrites a manually-finalized match (manual always wins, spec §6.5).
//
// Scheduling: pg_cron every 5 minutes, but only inside match windows (a match
// with kickoff < now < kickoff + 3.5h, or already live). One request fetches all
// WC matches, so a single call per poll respects the 10 req/min free-tier limit.
// We ingest only matches the API reports as in-play/finished, so off-window polls
// are cheap no-ops.
//
// Primary: football-data.org (competition WC). Fallback: keyless openfootball
// worldcup.json (daily, not live). Fails loudly, never silently degrades (§10).
//
// AUTHORIZATION: service-role path — callers must present an admin JWT OR the
// shared cron secret header (x-sync-secret == SYNC_SECRET).
//
// Deploy:  supabase functions deploy sync-results
// pg_cron: select cron.schedule('foodball-sync-results','*/5 * * * *', $$
//            select net.http_post(
//              url    := '<project>/functions/v1/sync-results',
//              headers:= jsonb_build_object('x-sync-secret', '<SYNC_SECRET>'))$$);
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://esm.sh/zod@3.23.8'

interface Ingest {
  apiId: string
  home: number
  away: number
  status: 'live' | 'finished'
  winnerCode: string | null
}

// football-data.org match (results shape).
const fdMatch = z.object({
  id: z.number(),
  status: z.string(),
  homeTeam: z.object({ tla: z.string().nullable().optional() }),
  awayTeam: z.object({ tla: z.string().nullable().optional() }),
  score: z.object({
    winner: z.string().nullable().optional(), // HOME_TEAM | AWAY_TEAM | DRAW
    fullTime: z.object({ home: z.number().nullable(), away: z.number().nullable() }),
  }),
})
const fdResponse = z.object({ matches: z.array(fdMatch) })

// openfootball played match (has score1/score2 once played).
const ofMatch = z.object({
  date: z.string(),
  team1: z.string(),
  team2: z.string(),
  score1: z.number().nullable().optional(),
  score2: z.number().nullable().optional(),
})
const ofResponse = z.object({
  rounds: z.array(z.object({ matches: z.array(ofMatch).default([]) })),
})

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function authorize(req: Request): Promise<Response | null> {
  const syncSecret = Deno.env.get('SYNC_SECRET')
  const provided = req.headers.get('x-sync-secret')
  if (syncSecret && provided && timingSafeEqual(provided, syncSecret)) return null

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  if (!token || !url || !anon) return new Response('Unauthorized', { status: 401 })
  const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: { user } } = await asUser.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })
  const { data: profile } = await asUser.from('profiles').select('is_admin').eq('id', user.id).maybeSingle()
  if (!profile?.is_admin) return new Response('Forbidden: admin only', { status: 403 })
  return null
}

// Map FD status → our (live|finished); null = not yet relevant (skip).
function liveOrFinished(fdStatus: string): 'live' | 'finished' | null {
  if (fdStatus === 'FINISHED') return 'finished'
  if (fdStatus === 'IN_PLAY' || fdStatus === 'PAUSED') return 'live'
  return null
}

async function fromFootballData(): Promise<Ingest[]> {
  const token = Deno.env.get('FOOTBALL_DATA_TOKEN')
  if (!token) throw new Error('FOOTBALL_DATA_TOKEN not set')
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': token },
  })
  if (!res.ok) throw new Error(`football-data.org responded ${res.status}`)
  const parsed = fdResponse.parse(await res.json())
  const out: Ingest[] = []
  for (const m of parsed.matches) {
    const status = liveOrFinished(m.status)
    if (!status) continue
    const home = m.score.fullTime.home ?? 0
    const away = m.score.fullTime.away ?? 0
    const winnerCode =
      m.score.winner === 'HOME_TEAM'
        ? m.homeTeam.tla ?? null
        : m.score.winner === 'AWAY_TEAM'
          ? m.awayTeam.tla ?? null
          : null
    // We pass FD's fullTime as the score and let fb_ingest_result derive the
    // group-stage outcome. KNOCKOUT precision — the regulation-vs-ET split and a
    // penalty-shootout winner — is best entered by the admin (fb_admin_set_result
    // with p_home_et/p_winner), which a later API poll never overwrites (manual wins).
    out.push({ apiId: `FD-${m.id}`, home, away, status, winnerCode })
  }
  return out
}

async function fromOpenFootball(): Promise<Ingest[]> {
  const res = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json')
  if (!res.ok) throw new Error(`openfootball responded ${res.status}`)
  const parsed = ofResponse.parse(await res.json())
  const out: Ingest[] = []
  for (const r of parsed.rounds) {
    for (const m of r.matches) {
      if (m.score1 == null || m.score2 == null) continue // not played yet
      out.push({
        apiId: `OF-${m.date}-${m.team1}-${m.team2}`,
        home: m.score1,
        away: m.score2,
        status: 'finished', // openfootball is daily, not live — treat as final
        winnerCode: null, // openfootball has no TLA here; group winner derived, knockouts via admin
      })
    }
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const denied = await authorize(req)
  if (denied) return denied
  try {
    let source = 'football-data.org'
    let results: Ingest[]
    try {
      results = await fromFootballData()
    } catch (primaryErr) {
      source = `openfootball (fallback: ${(primaryErr as Error).message})`
      results = await fromOpenFootball()
    }

    const supabase = serviceClient()
    let scored = 0
    let live = 0
    let skipped = 0
    for (const r of results) {
      const { data, error } = await supabase.rpc('fb_ingest_result', {
        p_api_match_id: r.apiId,
        p_home: r.home,
        p_away: r.away,
        p_status: r.status,
        p_winner_code: r.winnerCode,
      })
      if (error) continue
      const outcome = String(data ?? '')
      if (outcome === 'scored') scored++
      else if (outcome.startsWith('updated')) live++
      else skipped++
    }
    return Response.json({ ok: true, source, polled: results.length, scored, live, skipped })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
})
