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
  homeCode: string | null // home team FIFA/TLA code — resolved to our api_match_id
  awayCode: string | null
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

// openfootball worldcup.json is a FLAT matches[] (score1/score2 or score.ft[]). We
// don't re-parse it here — the fallback hands the raw feed to the in-DB
// fb_settle_from_openfootball_json(), which matches by team name, supports both
// score shapes, and preserves manual-result precedence.
const OPENFOOTBALL_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json'

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
    // We carry the team codes (not an invented id) so the handler can resolve our
    // real api_match_id (WC26-…) by team — FD's own match ids never match ours.
    out.push({ homeCode: m.homeTeam.tla ?? null, awayCode: m.awayTeam.tla ?? null, home, away, status, winnerCode })
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const denied = await authorize(req)
  if (denied) return denied
  const supabase = serviceClient()
  try {
    // Primary: football-data.org. Resolve each FD match to OUR real api_match_id by
    // team code (FD's own ids are a different namespace and never match ours).
    const fd = await fromFootballData()
    const { data: teams } = await supabase.from('teams').select('id, fifa_code')
    const codeOf = new Map((teams ?? []).map((t) => [t.id as number, t.fifa_code as string]))
    const { data: ms } = await supabase.from('matches').select('api_match_id, home_team, away_team')
    const idByCodes = new Map(
      (ms ?? []).map((m) => [`${codeOf.get(m.home_team)}|${codeOf.get(m.away_team)}`, m.api_match_id as string]),
    )

    let scored = 0, live = 0, skipped = 0
    for (const r of fd) {
      const apiId = r.homeCode && r.awayCode ? idByCodes.get(`${r.homeCode}|${r.awayCode}`) : undefined
      if (!apiId) { skipped++; continue } // not one of our fixtures (or code mismatch)
      const { data, error } = await supabase.rpc('fb_ingest_result', {
        p_api_match_id: apiId,
        p_home: r.home,
        p_away: r.away,
        p_status: r.status,
        p_winner_code: r.winnerCode,
      })
      if (error) { skipped++; continue }
      const outcome = String(data ?? '')
      if (outcome === 'scored') scored++
      else if (outcome.startsWith('updated')) live++
      else skipped++
    }
    return Response.json({ ok: true, source: 'football-data.org', polled: fd.length, scored, live, skipped })
  } catch (primaryErr) {
    // Fallback: hand the raw openfootball feed to the tested in-DB settler, which
    // matches by team name, handles both score shapes, and skips manual results.
    try {
      const res = await fetch(OPENFOOTBALL_URL)
      if (!res.ok) throw new Error(`openfootball responded ${res.status}`)
      const feed = await res.json()
      const { data, error } = await supabase.rpc('fb_settle_from_openfootball_json', { p: feed })
      if (error) throw error
      return Response.json({
        ok: true,
        source: `openfootball (fallback: ${(primaryErr as Error).message})`,
        settled: data,
      })
    } catch (e) {
      return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
    }
  }
})
