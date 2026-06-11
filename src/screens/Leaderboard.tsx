import { useEffect, useState } from 'react'
import { fetchLeaderboard } from '../lib/api'
import type { LeaderboardRow } from '../lib/database.types'
import { useAuth } from '../auth/AuthProvider'
import { Avatar } from '../components/Avatar'
import { COPY } from '../lib/copy'

const PLATE = ['🥇', '🥈', '🥉']

export function Leaderboard() {
  const { session } = useAuth()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetchLeaderboard()
      .then(setRows)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="px-4 pt-3 pb-24">
      <h1 className="font-display text-2xl text-yellow">{COPY.leaderboard}</h1>
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
