// One-off: emit SQL to import REAL World Cup 2026 group-stage fixtures from
// openfootball (keyless) — seeds all 48 teams, maps each group's 6 games to
// MD1/MD2/MD3, sets real kickoff times + round starts, and removes the demo
// fixtures. Idempotent (upserts by fifa_code / api_match_id). Knockouts
// (placeholder teams) are skipped until teams are known.
//
//   node scripts/import-real-fixtures.mjs > /tmp/fixtures.sql
//   docker exec -i supabase_db_foodball psql -U postgres -d postgres < /tmp/fixtures.sql
import { writeSync } from 'node:fs'

const SRC = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json'
const out = (s) => writeSync(1, s + '\n')

// name → [fifa_code, flag_emoji]. The 48 WC-2026 teams.
const TEAM = {
  Algeria: ['ALG', '🇩🇿'], Argentina: ['ARG', '🇦🇷'], Australia: ['AUS', '🇦🇺'], Austria: ['AUT', '🇦🇹'],
  Belgium: ['BEL', '🇧🇪'], 'Bosnia & Herzegovina': ['BIH', '🇧🇦'], Brazil: ['BRA', '🇧🇷'], Canada: ['CAN', '🇨🇦'],
  'Cape Verde': ['CPV', '🇨🇻'], Colombia: ['COL', '🇨🇴'], Croatia: ['CRO', '🇭🇷'], 'Curaçao': ['CUW', '🇨🇼'],
  'Czech Republic': ['CZE', '🇨🇿'], 'DR Congo': ['COD', '🇨🇩'], Ecuador: ['ECU', '🇪🇨'], Egypt: ['EGY', '🇪🇬'],
  England: ['ENG', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], France: ['FRA', '🇫🇷'], Germany: ['GER', '🇩🇪'], Ghana: ['GHA', '🇬🇭'],
  Haiti: ['HAI', '🇭🇹'], Iran: ['IRN', '🇮🇷'], Iraq: ['IRQ', '🇮🇶'], 'Ivory Coast': ['CIV', '🇨🇮'],
  Japan: ['JPN', '🇯🇵'], Jordan: ['JOR', '🇯🇴'], Mexico: ['MEX', '🇲🇽'], Morocco: ['MAR', '🇲🇦'],
  Netherlands: ['NED', '🇳🇱'], 'New Zealand': ['NZL', '🇳🇿'], Norway: ['NOR', '🇳🇴'], Panama: ['PAN', '🇵🇦'],
  Paraguay: ['PAR', '🇵🇾'], Portugal: ['POR', '🇵🇹'], Qatar: ['QAT', '🇶🇦'], 'Saudi Arabia': ['KSA', '🇸🇦'],
  Scotland: ['SCO', '🏴󠁧󠁢󠁳󠁣󠁴󠁿'], Senegal: ['SEN', '🇸🇳'], 'South Africa': ['RSA', '🇿🇦'], 'South Korea': ['KOR', '🇰🇷'],
  Spain: ['ESP', '🇪🇸'], Sweden: ['SWE', '🇸🇪'], Switzerland: ['SUI', '🇨🇭'], Tunisia: ['TUN', '🇹🇳'],
  Turkey: ['TUR', '🇹🇷'], USA: ['USA', '🇺🇸'], Uruguay: ['URU', '🇺🇷'], Uzbekistan: ['UZB', '🇺🇿'],
}
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
const tid = (code) => `(select id from public.teams where fifa_code = ${q(code)})`

function kickoffISO(date, time) {
  const [hm, tz] = time.split(' ')
  const off = (tz.match(/UTC([+-]\d+)/) || [, '+0'])[1]
  const sign = off.startsWith('-') ? '-' : '+'
  const hh = String(Math.abs(parseInt(off, 10))).padStart(2, '0')
  return `${date}T${hm}:00${sign}${hh}:00`
}

const data = await (await fetch(SRC)).json()
const group = (data.matches || []).filter((m) => (m.group || '').startsWith('Group'))

const teamGroup = new Map()
for (const m of group) for (const t of [m.team1, m.team2]) teamGroup.set(t, m.group.replace('Group ', ''))

out('begin;')
// Teams
const teamVals = [...teamGroup.entries()].map(([name, g]) => {
  const tm = TEAM[name]
  if (!tm) throw new Error(`No mapping for team: ${name}`)
  return `(${q(name)}, ${q(tm[0])}, ${q(tm[1])}, ${q(g)})`
})
out(`insert into public.teams (name, fifa_code, flag_emoji, group_letter) values\n${teamVals.join(',\n')}\non conflict (fifa_code) do update set name = excluded.name, flag_emoji = excluded.flag_emoji, group_letter = excluded.group_letter;`)

out(`delete from public.matches where api_match_id like 'DEMO-%';`)

// Each group's 6 games → MD1/MD2/MD3 by kickoff order.
const byGroup = new Map()
for (const m of group) {
  const g = m.group.replace('Group ', '')
  if (!byGroup.has(g)) byGroup.set(g, [])
  byGroup.get(g).push(m)
}
const rows = []
for (const [g, ms] of byGroup) {
  ms.sort((a, b) => kickoffISO(a.date, a.time).localeCompare(kickoffISO(b.date, b.time)))
  ms.forEach((m, i) => {
    const round_key = i < 2 ? 'MD1' : i < 4 ? 'MD2' : 'MD3'
    const hc = TEAM[m.team1][0]
    const ac = TEAM[m.team2][0]
    rows.push(`(${q(`WC26-${round_key}-${g}-${hc}-${ac}`)}, ${q(round_key)}, ${q(g)}, ${tid(hc)}, ${tid(ac)}, ${q(kickoffISO(m.date, m.time))}, 'scheduled', 'api')`)
  })
}
out(`insert into public.matches (api_match_id, round_key, group_letter, home_team, away_team, kickoff, status, result_source) values\n${rows.join(',\n')}\non conflict (api_match_id) do update set round_key = excluded.round_key, group_letter = excluded.group_letter, home_team = excluded.home_team, away_team = excluded.away_team, kickoff = excluded.kickoff;`)

for (const rk of ['MD1', 'MD2', 'MD3'])
  out(`update public.rounds set first_kickoff = (select min(kickoff) from public.matches where round_key = ${q(rk)} and api_match_id like 'WC26-%') where key = ${q(rk)};`)

// Flip currently-in-window matches to live (fires the kickoff commentary).
out(`update public.matches set status = 'live' where status = 'scheduled' and kickoff <= now() and now() < kickoff + interval '3.5 hours';`)
out('commit;')
