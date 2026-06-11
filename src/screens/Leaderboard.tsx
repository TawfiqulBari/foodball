import { useEffect, useState } from 'react'
import { fetchLeaderboard } from '../lib/api'
import { supabase } from '../lib/supabase'
import type { LeaderboardRow } from '../lib/database.types'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { COPY } from '../lib/copy'

const PLATE = ['🥇', '🥈', '🥉']

export function Leaderboard() {
  const { session } = useAuth()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState(false)
  const [err, setErr] = useState<string | null>(null)

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

  return (
    <div className="px-4 pt-3 pb-24">
      <h1 className="font-display text-2xl text-yellow flex items-center gap-2">
        {COPY.leaderboard}
        {live && (
          <span className="rounded-full bg-tomato/20 px-2 py-0.5 text-[11px] font-body font-bold text-tomato animate-pulse">
            ● LIVE
          </span>
        )}
      </h1>
      {err && <p className="text-tomato text-sm font-body">{err}</p>}
      {loading ? (
        <p className="mt-8 text-center font-body text-bunlight/60">Counting the courses…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-center font-body text-bunlight/60">{COPY.emptyLeaderboard}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const me = r.user_id === session?.user.id
            return (
              <li
                key={r.user_id}
                className={`flex items-center gap-3 rounded-card px-4 py-3 font-body ${
                  me ? 'bg-yellow text-navy' : 'bg-bunlight/95 text-navy'
                }`}
              >
                <span className="w-7 text-center font-display text-lg">
                  {r.rank <= 3 ? PLATE[r.rank - 1] : r.rank}
                </span>
                <Avatar name={r.display_name} config={r.avatar_config} size={r.rank <= 3 ? 48 : 36} />
                <span className="flex-1 font-bold">
                  {r.display_name}
                  {me && <span className="ml-2 text-xs font-normal">(you)</span>}
                </span>
                <RankDelta delta={r.rank_delta} />
                <span className="text-xs text-navy/60">{r.outcome_hits} ✓</span>
                <span className="font-display text-lg">{r.total}</span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** ▲/▼ movement since the last completed round (spec §7.3). */
function RankDelta({ delta }: { delta: number }) {
  if (!delta) return <span className="w-8 text-center text-xs text-navy/30" aria-hidden>–</span>
  const up = delta > 0
  return (
    <span
      className={`w-8 text-center text-xs font-bold ${up ? 'text-lettuce' : 'text-tomato'}`}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(delta)} since last round`}
    >
      {up ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  )
}
