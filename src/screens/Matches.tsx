import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import {
  fetchMatches,
  fetchMyPicks,
  fetchMyRoundProps,
  fetchPlayers,
  fetchRounds,
  fetchTeams,
  submitMatchPick,
  submitRoundProp,
} from '../lib/api'
import type {
  Market,
  MatchPick,
  MatchRow,
  PlayerCatalog,
  Prop,
  RoundProp,
  RoundRow,
  Team,
} from '../lib/database.types'
import { MatchCard } from '../components/MatchCard'
import { RoundPropsCard } from '../components/RoundPropsCard'
import { COPY } from '../lib/copy'

export function Matches() {
  const { session } = useAuth()
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [activeRound, setActiveRound] = useState<string>('MD1')
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [players, setPlayers] = useState<PlayerCatalog[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [picks, setPicks] = useState<Map<string, MatchPick>>(new Map())
  const [props, setProps] = useState<Map<Prop, RoundProp>>(new Map())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchRounds(), fetchTeams(), fetchPlayers()])
      .then(([r, t, p]) => {
        setRounds(r)
        setTeams(t)
        setPlayers(p)
        if (r.length && !r.some((x) => x.key === activeRound)) setActiveRound(r[0]!.key)
      })
      .catch((e) => setErr(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchMatches(activeRound), fetchMyPicks(), fetchMyRoundProps(activeRound)])
      .then(([m, p, rp]) => {
        setMatches(m)
        setPicks(p)
        setProps(rp)
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [activeRound])

  const round = useMemo(() => rounds.find((r) => r.key === activeRound), [rounds, activeRound])

  async function onPick(matchId: number, market: Market, selection: string) {
    if (!session) return
    await submitMatchPick(session.user.id, matchId, market, selection)
    setPicks((prev) => {
      const next = new Map(prev)
      const key = `${matchId}:${market}`
      const existing = next.get(key)
      next.set(key, {
        id: existing?.id ?? -1,
        user_id: session.user.id,
        match_id: matchId,
        market,
        selection,
        created_at: existing?.created_at ?? new Date().toISOString(),
        points_awarded: null,
      })
      return next
    })
  }

  async function onProp(prop: Prop, selection: string) {
    if (!session) return
    await submitRoundProp(session.user.id, activeRound, prop, selection)
    setProps((prev) => {
      const next = new Map(prev)
      const existing = next.get(prop)
      next.set(prop, {
        id: existing?.id ?? -1,
        user_id: session.user.id,
        round_key: activeRound,
        prop,
        selection,
        created_at: existing?.created_at ?? new Date().toISOString(),
        points_awarded: null,
      })
      return next
    })
  }

  /** Picks for one match, keyed by market. */
  function picksFor(matchId: number): Map<Market, MatchPick> {
    const m = new Map<Market, MatchPick>()
    for (const mk of ['outcome', 'exact_score', 'btts', 'over_under'] as Market[]) {
      const p = picks.get(`${matchId}:${mk}`)
      if (p) m.set(mk, p)
    }
    return m
  }

  return (
    <div className="px-4 pt-3">
      <RoundChips rounds={rounds} active={activeRound} onChange={setActiveRound} />
      {err && <p className="text-tomato text-sm font-body">{err}</p>}
      {loading ? (
        <p className="mt-8 text-center font-body text-bunlight/60">Plating up the fixtures…</p>
      ) : (
        <div className="mt-3 pb-24">
          <RoundPropsCard
            roundFirstKickoff={round?.first_kickoff ?? null}
            matches={matches}
            teams={teams}
            players={players}
            myProps={props}
            onSubmit={onProp}
          />
          {matches.length === 0 ? (
            <p className="mt-8 text-center font-body text-bunlight/60">{COPY.emptyMatches}</p>
          ) : (
            <div className="space-y-3">
              {matches.map((m) => (
                <MatchCard key={m.id} match={m} teams={teams} picks={picksFor(m.id)} onPick={(mk, sel) => onPick(m.id, mk, sel)} />
              ))}
            </div>
          )}
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
