import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { roundComplete } from '../lib/matchField'
import {
  fetchMatches,
  fetchMatchPicksGrace,
  fetchMyPicks,
  fetchMyRoundProps,
  fetchPlayers,
  fetchRoundPropsGrace,
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

export function Matches({ onRoundComplete }: { onRoundComplete?: () => void }) {
  const { session } = useAuth()
  const redirectedRounds = useRef<Set<string>>(new Set())
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [activeRound, setActiveRound] = useState<string>('MD1')
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [players, setPlayers] = useState<PlayerCatalog[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [picks, setPicks] = useState<Map<string, MatchPick>>(new Map())
  const [props, setProps] = useState<Map<Prop, RoundProp>>(new Map())
  const [propsGraceUntil, setPropsGraceUntil] = useState<string | null>(null)
  const [matchGraceUntil, setMatchGraceUntil] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      fetchRounds(),
      fetchTeams(),
      fetchPlayers(),
      fetchRoundPropsGrace(),
      fetchMatchPicksGrace(),
    ])
      .then(([r, t, p, propsGrace, matchGrace]) => {
        setRounds(r)
        setTeams(t)
        setPlayers(p)
        setPropsGraceUntil(propsGrace)
        setMatchGraceUntil(matchGrace)
        if (r.length && !r.some((x) => x.key === activeRound)) setActiveRound(r[0]!.key)
      })
      .catch((e) => setErr(String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const propsGraceActive = useMemo(
    () => (propsGraceUntil ? new Date(propsGraceUntil) > new Date() : false),
    [propsGraceUntil],
  )
  const matchGraceActive = useMemo(
    () => (matchGraceUntil ? new Date(matchGraceUntil) > new Date() : false),
    [matchGraceUntil],
  )

  useEffect(() => {
    let alive = true
    setLoading(true)
    const loadMatches = () => fetchMatches(activeRound).then((m) => alive && setMatches(m))
    Promise.all([loadMatches(), fetchMyPicks().then((p) => alive && setPicks(p)), fetchMyRoundProps(activeRound).then((rp) => alive && setProps(rp))])
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false))

    // Live scores (spec §7.3): refetch this round's matches when any match row
    // changes. Hosted Supabase publishes `matches` in M3; no-op locally.
    const channel = supabase
      .channel(`matches-${activeRound}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'matches', filter: `round_key=eq.${activeRound}` },
        () => void loadMatches(),
      )
      .subscribe()
    return () => {
      alive = false
      void supabase.removeChannel(channel)
    }
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
    // When the LAST outcome pick of the round lands, walk out to the Stadium.
    if (market === 'outcome' && !redirectedRounds.current.has(activeRound)) {
      const outcomeIds = new Set<number>([matchId])
      for (const m of matches) if (picks.has(`${m.id}:outcome`)) outcomeIds.add(m.id)
      if (roundComplete(outcomeIds, matches.map((m) => m.id))) {
        redirectedRounds.current.add(activeRound)
        onRoundComplete?.()
      }
    }
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
      {err && <p className="text-destructive text-sm font-body">{err}</p>}
      {loading ? (
        <p className="mt-8 text-center font-body text-muted-foreground">Plating up the fixtures…</p>
      ) : (
        <div className="mt-3 pb-24">
          <RoundPropsCard
            roundFirstKickoff={round?.first_kickoff ?? null}
            matches={matches}
            teams={teams}
            players={players}
            myProps={props}
            onSubmit={onProp}
            graceActive={propsGraceActive}
            graceUntil={propsGraceUntil}
          />
          {matches.length === 0 ? (
            <p className="mt-8 text-center font-body text-muted-foreground">{COPY.emptyMatches}</p>
          ) : (
            <div className="space-y-3">
              {matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  teams={teams}
                  picks={picksFor(m.id)}
                  onPick={(mk, sel) => onPick(m.id, mk, sel)}
                  graceActive={matchGraceActive}
                />
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
    <div className="no-scrollbar flex snap-x gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {rounds.map((r) => (
        <button
          key={r.key}
          type="button"
          onClick={() => onChange(r.key)}
          className={`shrink-0 snap-start min-h-tap rounded-full px-4 text-sm font-display transition ${
            active === r.key ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground border border-border hover:bg-accent'
          }`}
        >
          {r.key}
        </button>
      ))}
    </div>
  )
}
