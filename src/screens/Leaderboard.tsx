import { Fragment, useCallback, useEffect, useState } from 'react'
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { fetchLeaderboard } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { LeaderboardRow } from '../lib/database.types'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { COPY } from '../lib/copy'

const PLATE = ['🥇', '🥈', '🥉']
const RIVALS_KEY = 'fb.rivals'
const MAX_RIVALS = 3

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
  const myId = session?.user.id

  useEffect(() => {
    let alive = true
    const refresh = () =>
      fetchLeaderboard()
        .then((r) => alive && setRows(r))
        .catch((e) => alive && setErr(String(e)))
        .finally(() => alive && setLoading(false))
    void refresh()

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

  // Pinned rivals (spec §7.3) shown "stuck under your own row".
  const pinned = rows.filter((r) => rivals.includes(r.user_id) && r.user_id !== myId)

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
      {err && <p className="text-destructive text-sm font-body">{err}</p>}
      {loading ? (
        <p className="mt-8 text-center font-body text-muted-foreground">Counting the courses…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-center font-body text-muted-foreground">{COPY.emptyLeaderboard}</p>
      ) : (
        <LayoutGroup>
          <ul className="mt-3 space-y-2">
            {rows.map((r) => {
              const me = r.user_id === myId
              return (
                <Fragment key={r.user_id}>
                  <Row
                    row={r}
                    me={me}
                    pinned={rivals.includes(r.user_id)}
                    canPin={!me}
                    animate={!reduce}
                    onTogglePin={() => toggleRival(r.user_id)}
                  />
                  {/* Your rivals, stuck right under you. */}
                  {me &&
                    pinned.map((p) => (
                      <Row
                        key={`pin-${p.user_id}`}
                        row={p}
                        me={false}
                        pinned
                        canPin
                        animate={!reduce}
                        rival
                        onTogglePin={() => toggleRival(p.user_id)}
                      />
                    ))}
                </Fragment>
              )
            })}
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
  onTogglePin,
}: {
  row: LeaderboardRow
  me: boolean
  pinned: boolean
  canPin: boolean
  animate: boolean
  rival?: boolean
  onTogglePin: () => void
}) {
  return (
    <motion.li
      layout={animate}
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className={`flex items-center gap-3 rounded-card px-4 py-3 font-body ${
        rival ? 'ml-4' : ''
      } ${
        me ? 'bg-primary/10 text-foreground ring-2 ring-primary' : rival ? 'bg-card text-card-foreground shadow-sm ring-1 ring-bun' : 'bg-card text-card-foreground shadow-sm'
      }`}
    >
      <span className="w-7 text-center font-display text-lg">
        {row.rank <= 3 ? PLATE[row.rank - 1] : row.rank}
      </span>
      <Avatar name={row.display_name} config={row.avatar_config} size={row.rank <= 3 ? 48 : 36} />
      <span className="flex-1 font-bold">
        {row.display_name}
        {me && <span className="ml-2 text-xs font-normal">(you)</span>}
        {rival && <span className="ml-1 text-xs">📌</span>}
      </span>
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
    </motion.li>
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
