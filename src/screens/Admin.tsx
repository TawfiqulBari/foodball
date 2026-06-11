import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useAuth } from '../auth/AuthProvider'
import { adminSetResult, fetchMatches, fetchRounds, fetchTeams } from '../lib/api'
import type { MatchRow, RoundRow, Team } from '../lib/database.types'
import { kickoffLabel } from '../lib/format'

const scoreSchema = z.coerce.number().int().min(0).max(99)

export function Admin() {
  const { profile } = useAuth()
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [round, setRound] = useState('MD1')
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchRounds(), fetchTeams()]).then(([r, t]) => {
      setRounds(r)
      setTeams(t)
    })
  }, [])
  useEffect(() => {
    fetchMatches(round).then(setMatches)
  }, [round])

  if (!profile?.is_admin) {
    return <p className="px-4 pt-8 text-center font-body text-tomato">Admins only — this kitchen is staff-only.</p>
  }

  return (
    <div className="px-4 pt-3 pb-24 font-body text-bunlight">
      <h1 className="font-display text-2xl text-yellow">Admin · Result entry</h1>
      <p className="text-xs text-bunlight/60">Manual results always win over the API feed (spec §6.5).</p>

      <div className="mt-3 flex gap-2 overflow-x-auto">
        {rounds.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRound(r.key)}
            className={`shrink-0 min-h-tap rounded-full px-3 text-sm font-display ${
              round === r.key ? 'bg-yellow text-navy' : 'bg-navy/40'
            }`}
          >
            {r.key}
          </button>
        ))}
      </div>

      {msg && <p className="mt-2 text-lettuce text-sm">{msg}</p>}

      <ul className="mt-3 space-y-3">
        {matches.map((m) => (
          <AdminRow key={m.id} match={m} teams={teams} onSaved={(t) => setMsg(t)} onRefresh={() => fetchMatches(round).then(setMatches)} />
        ))}
      </ul>
    </div>
  )
}

function AdminRow({
  match,
  teams,
  onSaved,
  onRefresh,
}: {
  match: MatchRow
  teams: Map<number, Team>
  onSaved: (msg: string) => void
  onRefresh: () => void
}) {
  const home = teams.get(match.home_team)
  const away = teams.get(match.away_team)
  const [h, setH] = useState(String(match.home_score ?? ''))
  const [a, setA] = useState(String(match.away_score ?? ''))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const hp = scoreSchema.safeParse(h)
    const ap = scoreSchema.safeParse(a)
    if (!hp.success || !ap.success) {
      setErr('Scores must be whole numbers 0–99.')
      return
    }
    // Group stage: draw allowed (winner stays null). Knockout winner entry is M2.
    const winner = hp.data > ap.data ? match.home_team : ap.data > hp.data ? match.away_team : null
    setBusy(true)
    try {
      await adminSetResult({ matchId: match.id, home: hp.data, away: ap.data, winner })
      onSaved(`Saved ${home?.fifa_code} ${hp.data}–${ap.data} ${away?.fifa_code} · scored.`)
      onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-card bg-bunlight/95 text-navy p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold">
          {home?.flag_emoji} {home?.fifa_code} vs {away?.fifa_code} {away?.flag_emoji}
        </span>
        <span className="text-xs text-navy/50">
          {kickoffLabel(match.kickoff)} · {match.status}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input
          aria-label={`${home?.fifa_code} score`}
          inputMode="numeric"
          value={h}
          onChange={(e) => setH(e.target.value)}
          className="w-14 min-h-tap rounded text-center"
        />
        <span>–</span>
        <input
          aria-label={`${away?.fifa_code} score`}
          inputMode="numeric"
          value={a}
          onChange={(e) => setA(e.target.value)}
          className="w-14 min-h-tap rounded text-center"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="ml-auto min-h-tap rounded-lg bg-navy px-4 font-display text-yellow active:scale-95 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save & score'}
        </button>
      </div>
      {err && <p className="mt-1 text-xs text-tomato">{err}</p>}
    </li>
  )
}
