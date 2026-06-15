import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { fetchAllMatches, fetchLeaderboard, fetchMatchPicksForUser, fetchTeams } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { LeaderboardRow, MatchPick, MatchRow, Team } from '../lib/database.types'
import { pickLabel } from '../lib/matchField'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { COPY } from '../lib/copy'

const PLATE = ['🥇', '🥈', '🥉']
const RIVALS_KEY = 'fb.rivals'
const MAX_RIVALS = 3
const MARKET_ORDER: Record<string, number> = { outcome: 0, exact_score: 1, btts: 2, over_under: 3 }

function loadRivals(): string[] {
  try {
    const raw = localStorage.getItem(RIVALS_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

export function Leaderboard() {
  const { session } = useAuth()
  const reduce = useReducedMotion()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [rivals, setRivals] = useState<string[]>(loadRivals)
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  // Predictions expand: reference data + a lazy per-user pick cache.
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [picksByUser, setPicksByUser] = useState<Map<string, MatchPick[]>>(new Map())
  const [picksLoading, setPicksLoading] = useState<string | null>(null)
  const myId = session?.user.id

  useEffect(() => {
    let alive = true
    const refresh = () =>
      fetchLeaderboard()
        .then((r) => alive && setRows(r))
        .catch((e) => alive && setErr(String(e)))
        .finally(() => alive && setLoading(false))
    void refresh()
    // Reference data for the predictions expand (teams + every match).
    void Promise.all([fetchTeams(), fetchAllMatches()])
      .then(([t, m]) => {
        if (!alive) return
        setTeams(t)
        setMatches(m)
      })
      .catch(() => {})

    // Realtime (spec §7.3): re-pull The Food Chain whenever points land. On a
    // hosted Supabase project score_events is in the realtime publication (M3);
    // locally there's no realtime server, so this simply never fires.
    const channel = supabase
      .channel('food-chain')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'score_events' }, () => {
        setLive(true)
        void refresh()
      })
      .subscribe()
    return () => {
      alive = false
      void supabase.removeChannel(channel)
    }
  }, [])

  const toggleRival = useCallback((userId: string) => {
    setRivals((prev) => {
      const next = prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId].slice(-MAX_RIVALS)
      try {
        localStorage.setItem(RIVALS_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const toggleExpand = useCallback(
    (userId: string) => {
      setExpanded((cur) => (cur === userId ? null : userId))
      if (!picksByUser.has(userId)) {
        setPicksLoading(userId)
        fetchMatchPicksForUser(userId)
          .then((p) => setPicksByUser((m) => new Map(m).set(userId, p)))
          .catch((e) => setErr(String(e)))
          .finally(() => setPicksLoading((u) => (u === userId ? null : u)))
      }
    },
    [picksByUser],
  )

  // Pinned rivals (spec §7.3) shown "stuck under your own row".
  const pinned = rows.filter((r) => rivals.includes(r.user_id) && r.user_id !== myId)

  const renderRow = (r: LeaderboardRow, rival: boolean) => (
    <Row
      row={r}
      me={r.user_id === myId}
      pinned={rivals.includes(r.user_id)}
      canPin={r.user_id !== myId}
      animate={!reduce}
      rival={rival}
      expanded={expanded === r.user_id}
      onToggleExpand={() => toggleExpand(r.user_id)}
      onTogglePin={() => toggleRival(r.user_id)}
      picks={picksByUser.get(r.user_id)}
      picksLoading={picksLoading === r.user_id}
      isSelf={r.user_id === myId}
      matches={matches}
      teams={teams}
    />
  )

  return (
    <div className="px-4 pt-3 pb-24">
      <h1 className="font-display text-2xl text-primary flex items-center gap-2">
        {COPY.leaderboard}
        {live && (
          <span className="rounded-full bg-tomato/20 px-2 py-0.5 text-[11px] font-body font-bold text-destructive animate-pulse">
            ● LIVE
          </span>
        )}
      </h1>
      <p className="mt-0.5 font-body text-xs text-muted-foreground">Tap a chef to see their predictions.</p>
      {err && <p className="text-destructive text-sm font-body">{err}</p>}
      {loading ? (
        <p className="mt-8 text-center font-body text-muted-foreground">Counting the courses…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-center font-body text-muted-foreground">{COPY.emptyLeaderboard}</p>
      ) : (
        <LayoutGroup>
          <ul className="mt-3 space-y-2">
            {rows.map((r) => (
              <Fragment key={r.user_id}>
                {renderRow(r, false)}
                {/* Your rivals, stuck right under you. */}
                {r.user_id === myId && pinned.map((p) => <Fragment key={`pin-${p.user_id}`}>{renderRow(p, true)}</Fragment>)}
              </Fragment>
            ))}
          </ul>
        </LayoutGroup>
      )}
    </div>
  )
}

function Row({
  row,
  me,
  pinned,
  canPin,
  animate,
  rival = false,
  expanded,
  onToggleExpand,
  onTogglePin,
  picks,
  picksLoading,
  isSelf,
  matches,
  teams,
}: {
  row: LeaderboardRow
  me: boolean
  pinned: boolean
  canPin: boolean
  animate: boolean
  rival?: boolean
  expanded: boolean
  onToggleExpand: () => void
  onTogglePin: () => void
  picks?: MatchPick[]
  picksLoading: boolean
  isSelf: boolean
  matches: MatchRow[]
  teams: Map<number, Team>
}) {
  return (
    <motion.li
      layout={animate}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className={`rounded-card font-body ${rival ? 'ml-4' : ''} ${
        me ? 'bg-primary/10 text-foreground ring-2 ring-primary' : rival ? 'bg-card text-card-foreground shadow-sm ring-1 ring-bun' : 'bg-card text-card-foreground shadow-sm'
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="w-7 text-center font-display text-lg">
          {row.rank <= 3 ? PLATE[row.rank - 1] : row.rank}
        </span>
        <Avatar name={row.display_name} config={row.avatar_config} size={row.rank <= 3 ? 48 : 36} />
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="truncate font-bold">
            {row.display_name}
            {me && <span className="ml-2 text-xs font-normal">(you)</span>}
            {rival && <span className="ml-1 text-xs">📌</span>}
          </span>
          <span className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden>
            ▾
          </span>
        </button>
        <RankDelta delta={row.rank_delta} />
        <span className="text-xs text-muted-foreground">{row.outcome_hits} ✓</span>
        <span className="w-8 text-right font-display text-lg">{row.total}</span>
        {canPin && (
          <button
            type="button"
            onClick={onTogglePin}
            aria-label={pinned ? 'Unpin rival' : 'Pin rival'}
            aria-pressed={pinned}
            className={`text-lg leading-none ${pinned ? 'text-bun' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {pinned ? '★' : '☆'}
          </button>
        )}
      </div>
      {expanded && (
        <PredictionsPanel picks={picks} loading={picksLoading} isSelf={isSelf} matches={matches} teams={teams} />
      )}
    </motion.li>
  )
}

/** What this chef predicted, match by match. Outcome picks resolve to the team
 *  they backed via the shared, tested `pickLabel` (home→home team — never inverted). */
function PredictionsPanel({
  picks,
  loading,
  isSelf,
  matches,
  teams,
}: {
  picks?: MatchPick[]
  loading: boolean
  isSelf: boolean
  matches: MatchRow[]
  teams: Map<number, Team>
}) {
  const byMatch = useMemo(() => {
    const m = new Map<number, MatchPick[]>()
    for (const p of picks ?? []) {
      const arr = m.get(p.match_id) ?? []
      arr.push(p)
      m.set(p.match_id, arr)
    }
    return m
  }, [picks])

  const predicted = useMemo(
    () =>
      matches
        .filter((m) => byMatch.has(m.id))
        .sort((a, b) => new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()),
    [matches, byMatch],
  )

  if (loading) {
    return <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">Reading the order…</p>
  }
  if (predicted.length === 0) {
    return (
      <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
        {isSelf ? 'No predictions yet.' : 'No predictions visible yet — others’ picks reveal at kickoff.'}
      </p>
    )
  }

  return (
    <ul className="border-t border-border px-4 py-2 text-sm">
      {predicted.map((m) => {
        const h = teams.get(m.home_team)
        const a = teams.get(m.away_team)
        const mPicks = (byMatch.get(m.id) ?? []).slice().sort((x, y) => (MARKET_ORDER[x.market] ?? 9) - (MARKET_ORDER[y.market] ?? 9))
        const finished = m.status === 'finished'
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/50 py-1.5 last:border-0">
            <span className="font-semibold text-muted-foreground">
              {h?.fifa_code ?? '?'} <span className="font-normal">v</span> {a?.fifa_code ?? '?'}
            </span>
            {finished && (
              <span className="text-xs text-muted-foreground">({m.home_score}–{m.away_score})</span>
            )}
            <span className="flex flex-1 flex-wrap items-center justify-end gap-1">
              {mPicks.map((p) => {
                const hit = (p.points_awarded ?? 0) > 0
                return (
                  <span
                    key={p.market}
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      !finished
                        ? 'bg-muted text-foreground'
                        : hit
                          ? 'bg-lettuce/20 text-lettuce'
                          : 'bg-destructive/15 text-destructive'
                    }`}
                    title={p.market}
                  >
                    {pickLabel(p.market, p.selection, m, teams)}
                    {finished && (p.points_awarded != null) && (hit ? ` +${p.points_awarded}` : ' +0')}
                  </span>
                )
              })}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** ▲/▼ movement since the last completed round (spec §7.3). */
function RankDelta({ delta }: { delta: number }) {
  if (!delta) return <span className="w-8 text-center text-xs text-muted-foreground" aria-hidden>–</span>
  const up = delta > 0
  return (
    <span
      className={`w-8 text-center text-xs font-bold ${up ? 'text-lettuce' : 'text-destructive'}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(delta)} since last round`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(delta)}
    </span>
  )
}
