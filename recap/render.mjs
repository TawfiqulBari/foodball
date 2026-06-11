// FoodBall recap renderer (spec §9 M5):  npm run render -- --round=MD2
// Pulls the leaderboard via the Supabase SERVICE key, renders the avatars to data
// URIs, and renders the Remotion <Recap> composition to out/recap-<round>.mp4.
// With no SUPABASE creds it renders baked DEMO data so the pipeline is verifiable
// offline. Never bundles the service key into anything client-facing.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderMedia, selectComposition } from '@remotion/renderer'
import { createClient } from '@supabase/supabase-js'
import { createAvatar } from '@dicebear/core'
import { adventurer } from '@dicebear/collection'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const ROUND_NAMES = {
  MD1: 'Group Matchday 1', MD2: 'Group Matchday 2', MD3: 'Group Matchday 3',
  R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals',
  SF: 'Semi-finals', F: 'Third place + Final',
}

function arg(name, def) {
  const flag = `--${name}`
  const i = process.argv.indexOf(flag)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`))
  return eq ? eq.split('=')[1] : def
}

function avatarFor(name, cfg) {
  const bg = cfg && typeof cfg.backgroundColor === 'string' ? cfg.backgroundColor : 'F2A93B'
  const salt = cfg && typeof cfg.seedSalt === 'string' ? cfg.seedSalt : ''
  return createAvatar(adventurer, { seed: `${name}${salt}`, backgroundColor: [bg], radius: 50 }).toDataUri()
}

const DEMO = [
  { rank: 1, display_name: 'Chef Tawfiq', total: 145, rank_delta: 2, avatar_config: { backgroundColor: 'FFC857' } },
  { rank: 2, display_name: 'Alice', total: 130, rank_delta: -1, avatar_config: { backgroundColor: '7CC243' } },
  { rank: 3, display_name: 'Bob', total: 120, rank_delta: 3, avatar_config: { backgroundColor: '17A2C4' } },
  { rank: 4, display_name: 'Carol', total: 95, rank_delta: -2, avatar_config: { backgroundColor: 'E2504C' } },
  { rank: 5, display_name: 'Dave', total: 80, rank_delta: 0, avatar_config: { backgroundColor: '1C7293' } },
  { rank: 6, display_name: 'Erin', total: 60, rank_delta: 1, avatar_config: { backgroundColor: 'F2A93B' } },
]

async function fetchRows() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('⚠️  No SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — rendering DEMO data.')
    return DEMO
  }
  const sb = createClient(url, key, { auth: { persistSession: false } })
  const { data, error } = await sb.from('leaderboard').select('*').order('rank')
  if (error) throw error
  return data ?? []
}

const round = arg('round', 'MD2')
const raw = await fetchRows()
const rows = raw.map((r) => ({
  rank: r.rank,
  display_name: r.display_name,
  total: r.total,
  rank_delta: r.rank_delta ?? 0,
  avatar: avatarFor(r.display_name, r.avatar_config),
}))
const inputProps = {
  round,
  roundName: ROUND_NAMES[round] ?? round,
  generatedAt: new Date().toISOString(),
  rows,
}

console.log(`🍔 Bundling Remotion…`)
const serveUrl = await bundle({ entryPoint: path.join(__dirname, 'src/index.ts') })
const composition = await selectComposition({ serveUrl, id: 'Recap', inputProps })
const outputLocation = path.join(__dirname, 'out', `recap-${round}.mp4`)
console.log(`🎬 Rendering ${outputLocation} …`)
await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation, inputProps })
console.log(`✅ Done: ${outputLocation}`)
