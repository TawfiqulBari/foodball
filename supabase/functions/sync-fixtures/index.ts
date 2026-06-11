// FoodBall — sync-fixtures Edge Function (spec §6.1).
// Pulls the WC fixture list and upserts teams + matches, idempotent by
// api_match_id. Primary: football-data.org (competition WC). If the free tier
// does not expose WC 2026 (spec §10), it FAILS LOUDLY and falls back to the
// keyless openfootball worldcup.json — it never silently degrades.
//
// AUTHORIZATION: this path uses the service-role key (bypasses RLS), so it is
// gated — callers must EITHER present an admin user's JWT, OR a shared cron
// secret header (x-sync-secret == SYNC_SECRET) for pg_cron/scheduler use.
//
// Deploy:  supabase functions deploy sync-fixtures
// Secrets: FOOTBALL_DATA_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//          SUPABASE_ANON_KEY, SYNC_SECRET (all server-side; never in the client).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://esm.sh/zod@3.23.8'

interface Fixture { apiId: string; date: string; home: string; away: string; roundKey: string }

const fdMatch = z.object({
  id: z.number(),
  utcDate: z.string(),
  stage: z.string().optional(),
  matchday: z.number().nullable().optional(),
  group: z.string().nullable().optional(),
  homeTeam: z.object({ name: z.string(), tla: z.string().nullable().optional() }),
  awayTeam: z.object({ name: z.string(), tla: z.string().nullable().optional() }),
})
const fdResponse = z.object({ matches: z.array(fdMatch) })

const ofMatch = z.object({ date: z.string(), team1: z.string(), team2: z.string() })
const ofResponse = z.object({
  rounds: z.array(z.object({ name: z.string().optional(), matches: z.array(ofMatch).default([]) })),
})

// Map a football-data stage (+ matchday) to FoodBall round keys (spec §3).
function roundKeyFor(stage?: string, matchday?: number | null): string {
  switch (stage) {
    case 'LAST_32': return 'R32'
    case 'LAST_16': return 'R16'
    case 'QUARTER_FINALS': return 'QF'
    case 'SEMI_FINALS': return 'SF'
    case 'THIRD_PLACE':
    case 'FINAL': return 'F'
    case 'GROUP_STAGE':
    default:
      return matchday === 2 ? 'MD2' : matchday === 3 ? 'MD3' : 'MD1'
  }
}

function serviceClient() {
  const url = Deno.env.get('SUPABASE_URL')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

// Authorize: admin JWT (preferred) OR the shared cron secret. Returns null when OK.
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

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function fromFootballData(): Promise<Fixture[]> {
  const token = Deno.env.get('FOOTBALL_DATA_TOKEN')
  if (!token) throw new Error('FOOTBALL_DATA_TOKEN not set')
  const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': token },
  })
  if (!res.ok) throw new Error(`football-data.org responded ${res.status}`)
  const parsed = fdResponse.parse(await res.json())
  if (parsed.matches.length === 0) throw new Error('football-data.org returned 0 WC matches (free tier may exclude WC 2026)')
  return parsed.matches.map((m) => ({
    apiId: `FD-${m.id}`,
    date: m.utcDate,
    home: m.homeTeam.name,
    away: m.awayTeam.name,
    roundKey: roundKeyFor(m.stage, m.matchday),
  }))
}

async function fromOpenFootball(): Promise<Fixture[]> {
  const res = await fetch('https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json')
  if (!res.ok) throw new Error(`openfootball responded ${res.status}`)
  const parsed = ofResponse.parse(await res.json())
  const out: Fixture[] = []
  for (const r of parsed.rounds) {
    for (const m of r.matches) {
      out.push({ apiId: `OF-${m.date}-${m.team1}-${m.team2}`, date: `${m.date}T00:00:00Z`, home: m.team1, away: m.team2, roundKey: 'MD1' })
    }
  }
  if (out.length === 0) throw new Error('openfootball returned 0 matches')
  return out
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const denied = await authorize(req)
  if (denied) return denied
  try {
    let source = 'football-data.org'
    let fixtures: Fixture[]
    try {
      fixtures = await fromFootballData()
    } catch (primaryErr) {
      source = `openfootball (fallback: ${(primaryErr as Error).message})`
      fixtures = await fromOpenFootball()
    }

    const supabase = serviceClient()
    // M1 scope: resolve teams by name against pre-seeded rows and upsert matches
    // only. Team auto-creation from the API and players_catalog (squads) are a
    // later-milestone deliverable (spec §6.1) — matches between unseeded teams
    // are reported as skipped rather than silently dropped.
    const { data: teams } = await supabase.from('teams').select('id,name')
    const byName = new Map<string, number>((teams ?? []).map((t: { id: number; name: string }) => [t.name, t.id]))

    let upserted = 0
    const skipped: string[] = []
    for (const f of fixtures) {
      const home = byName.get(f.home)
      const away = byName.get(f.away)
      if (!home || !away) { skipped.push(`${f.home} vs ${f.away}`); continue }
      const { error } = await supabase.from('matches').upsert(
        { api_match_id: f.apiId, round_key: f.roundKey, home_team: home, away_team: away, kickoff: f.date, status: 'scheduled', result_source: 'api' },
        { onConflict: 'api_match_id' },
      )
      if (!error) upserted++
    }

    return Response.json({ ok: true, source, fixtures: fixtures.length, upserted, skipped: skipped.length, skipped_sample: skipped.slice(0, 5) })
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
})
