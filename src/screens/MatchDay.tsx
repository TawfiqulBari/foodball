import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchAllMatches, fetchOutcomePickers, fetchProfilesByIds, fetchTeams } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { MatchRow, Team } from '../lib/database.types'
import {
  assignSides,
  matchDayTabs,
  scoredSide,
  type Picker,
  type Side,
} from '../lib/matchField'
import { MatchPitch } from '../components/MatchPitch'
import { CommentaryFeed } from '../components/CommentaryFeed'
import { kickoffLabel } from '../lib/format'
import { COPY } from '../lib/copy'

const CELEBRATE_MS = 6000

export function MatchDay() {
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [picks, setPicks] = useState<{ user_id: string; selection: string }[]>([])
  const [profiles, setProfiles] = useState<Map<string, Picker>>(new Map())
  const [celebrating, setCelebrating] = useState<Side | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  // userPinnedTab: once the user taps a tab, don't yank them to a new default.
  const pinnedRef = useRef(false)
  const scoresRef = useRef<Map<number, { home: number; away: number }>>(new Map())
  const celebTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([fetchAllMatches(), fetchTeams()])
      .then(([ms, ts]) => {
        if (!alive) return
        setMatches(ms)
        setTeams(ts)
        ms.forEach((m) => scoresRef.current.set(m.id, { home: m.home_score ?? 0, away: m.away_score ?? 0 }))
        if (!pinnedRef.current) setSelectedId(matchDayTabs(ms).defaultId)
      })
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false))

    // Live goals: update scores in place + fire the cheer/cry when a side scores.
    const channel = supabase
      .channel('match-day')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, (payload) => {
        const next = payload.new as MatchRow
        const prev = scoresRef.current.get(next.id)
        const side = scoredSide(prev ? { home_score: prev.home, away_score: prev.away } : undefined, next)
        scoresRef.current.set(next.id, { home: next.home_score ?? 0, away: next.away_score ?? 0 })
        setMatches((cur) => cur.map((m) => (m.id === next.id ? { ...m, ...next } : m)))
        setSelectedId((sel) => {
          if (side && next.id === sel) {
            setCelebrating(side)
            if (celebTimer.current) clearTimeout(celebTimer.current)
            celebTimer.current = setTimeout(() => setCelebrating(null), CELEBRATE_MS)
          }
          return sel
        })
      })
      .subscribe()
    return () => {
      alive = false
      if (celebTimer.current) clearTimeout(celebTimer.current)
      void supabase.removeChannel(channel)
    }
  }, [])

  // Load the selected match's pickers + their profiles. Guarded against a tab-
  // switch race: if selectedId changes (or we unmount) before the two network
  // calls resolve, we drop the stale results instead of painting the wrong match.
  useEffect(() => {
    if (selectedId == null) return
    let cancelled = false
    setCelebrating(null)
    if (celebTimer.current) clearTimeout(celebTimer.current)
    ;(async () => {
      try {
        const p = await fetchOutcomePickers(selectedId)
        const profs = await fetchProfilesByIds([...new Set(p.map((x) => x.user_id))])
        if (cancelled) return
        setPicks(p)
        setProfiles(
          new Map(
            [...profs.values()].map((pr) => [
              pr.id,
              { user_id: pr.id, display_name: pr.display_name, avatar_config: pr.avatar_config },
            ]),
          ),
        )
      } catch (e) {
        if (!cancelled) setErr(String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  const { tabs } = useMemo(() => matchDayTabs(matches), [matches])
  const selected = matches.find((m) => m.id === selectedId)
  const sides = useMemo(() => assignSides(picks, profiles), [picks, profiles])

  function selectTab(id: number) {
    pinnedRef.current = true
    setSelectedId(id)
  }

  return (
    <div className="px-2 pt-3 pb-24">
      <h1 className="px-1 font-display text-2xl font-extrabold tracking-tight text-foreground">Match Day</h1>
      <p className="px-1 font-body text-muted-foreground text-sm">Where every chef stands. Goals make the stands erupt.</p>
      {err && <p className="px-1 text-destructive text-sm font-body">{err}</p>}

      {/* Match tabs */}
      {tabs.length > 1 && (
        <div className="no-scrollbar mt-3 flex snap-x gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {tabs.map((m) => {
            const h = teams.get(m.home_team)
            const a = teams.get(m.away_team)
            const on = m.id === selectedId
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => selectTab(m.id)}
                className={`shrink-0 min-h-tap rounded-full px-3 text-xs font-display transition ${
                  on ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground border border-border'
                }`}
              >
                {h?.fifa_code ?? '?'} v {a?.fifa_code ?? '?'}
                {m.status === 'live' && <span className="ml-1 text-destructive">●</span>}
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <p className="mt-8 text-center font-body text-muted-foreground">Walking out to the pitch…</p>
      ) : !selected ? (
        <p className="mt-8 text-center font-body text-muted-foreground">{COPY.emptyMatches}</p>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-center text-xs font-body text-muted-foreground">
            {selected.group_letter ? `Group ${selected.group_letter} · ` : ''}
            {kickoffLabel(selected.kickoff)}
            {selected.status === 'scheduled' && ' · picks reveal at kickoff'}
          </p>
          <MatchPitch
            home={teams.get(selected.home_team)}
            away={teams.get(selected.away_team)}
            sides={sides}
            scoreHome={selected.home_score ?? 0}
            scoreAway={selected.away_score ?? 0}
            live={selected.status === 'live'}
            finished={selected.status === 'finished'}
            celebrating={celebrating}
          />
          <CommentaryFeed matchId={selected.id} />
        </div>
      )}
    </div>
  )
}
