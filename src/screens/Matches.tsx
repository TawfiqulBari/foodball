import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchMatches, fetchMyPicks, fetchRounds, fetchTeams, submitOutcomePick } from '../lib/api'
import type { MatchPick, MatchRow, Outcome, RoundRow, Team } from '../lib/database.types'
import { MatchCard } from '../components/MatchCard'
import { COPY } from '../lib/copy'

export function Matches() {
  const { session } = useAuth()
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [activeRound, setActiveRound] = useState<string>('MD1')
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [picks, setPicks] = useState<Map<string, MatchPick>>(new Map())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchRounds(), fetchTeams()])
      .then(([r, t]) => {
        setRounds(r)
        setTeams(t)
        if (r.length && !r.some((x) => x.key === activeRound)) setActiveRound(r[0]!.key)
      })
      .catch((e) => setErr(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchMatches(activeRound), fetchMyPicks()])
      .then(([m, p]) => {
        setMatches(m)
        setPicks(p)
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [activeRound])

  async function onPick(matchId: number, selection: Outcome) {
    if (!session) return
    await submitOutcomePick(session.user.id, matchId, selection)
    setPicks((prev) => {
      const next = new Map(prev)
      const key = `${matchId}:outcome`
      const existing = next.get(key)
      next.set(key, {
        id: existing?.id ?? -1,
        user_id: session.user.id,
        match_id: matchId,
        market: 'outcome',
        selection,
        created_at: new Date().toISOString(),
        points_awarded: null,
      })
      return next
    })
  }

  return (
    <div className="px-4 pt-3">
      <RoundChips rounds={rounds} active={activeRound} onChange={setActiveRound} />
      {err && <p className="text-tomato text-sm font-body">{err}</p>}
      {loading ? (
        <p className="mt-8 text-center font-body text-bunlight/60">Plating up the fixtures…</p>
      ) : matches.length === 0 ? (
        <p className="mt-8 text-center font-body text-bunlight/60">{COPY.emptyMatches}</p>
      ) : (
        <div className="mt-3 space-y-3 pb-24">
          {matches.map((m) => (
            <MatchCard key={m.id} match={m} teams={teams} pick={picks.get(`${m.id}:outcome`)} onPick={onPick} />
          ))}
        </div>
      )}
    </div>
  )
}

function RoundChips({
  rounds,
  active,
  onChange,
}: {
  rounds: RoundRow[]
  active: string
  onChange: (k: string) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {rounds.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          className={`shrink-0 min-h-tap rounded-full px-4 text-sm font-display transition ${
            active === r.key ? 'bg-yellow text-navy' : 'bg-navy/40 text-bunlight/80 hover:bg-navy/60'
          }`}
        >
          {r.key}
        </button>
      ))}
    </div>
  )
}
