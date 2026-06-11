import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { fetchMyPicks, fetchTeams } from '../lib/api'
import type { MatchRow, Team } from '../lib/database.types'
import { computeResultMoments, type ResultMoment } from '../lib/resultMoments'
import { ResultOverlay } from './ResultOverlay'

const SEEN_KEY = 'fb.seenMoments'
const MAX_BURST = 5 // don't replay a huge backlog on a fresh device

function loadSeen(): Set<number> {
  try {
    const raw = localStorage.getItem(SEEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as number[]) : [])
  } catch {
    return new Set()
  }
}
function persistSeen(s: Set<number>): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...s]))
  } catch {
    /* private mode / quota — overlays just replay; harmless */
  }
}

/** Drives the result-moment overlays (spec §7.5): scans the user's finished
 *  picks for unseen results, queues them, and plays them ONE AT A TIME — the
 *  next only mounts after the current is dismissed, so overlays never stack.
 *  Re-scans on the matches Realtime channel so results that land while the app
 *  is open pop immediately. */
export function ResultMoments() {
  const { session } = useAuth()
  const [queue, setQueue] = useState<ResultMoment[]>([])
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())

  const scan = useCallback(async () => {
    const pickMap = await fetchMyPicks()
    const picks = [...pickMap.values()]
    const ids = [...new Set(picks.map((p) => p.match_id))]
    if (ids.length === 0) return
    const { data } = await supabase.from('matches').select('*').in('id', ids)
    const matches = (data ?? []) as MatchRow[]
    const fresh = computeResultMoments(picks, matches, loadSeen()).slice(0, MAX_BURST)
    if (fresh.length === 0) return
    setQueue((prev) => {
      const have = new Set(prev.map((m) => m.matchId))
      return [...prev, ...fresh.filter((m) => !have.has(m.matchId))]
    })
  }, [])

  useEffect(() => {
    if (!session) return
    let alive = true
    fetchTeams()
      .then((t) => alive && setTeams(t))
      .catch(() => {})
    void scan()
    const channel = supabase
      .channel('result-moments')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'matches' }, () => void scan())
      .subscribe()
    return () => {
      alive = false
      void supabase.removeChannel(channel)
    }
  }, [session, scan])

  if (queue.length === 0) return null
  const current = queue[0]!
  const code = (id: number) => teams.get(id)?.fifa_code ?? '?'

  return (
    <AnimatePresence mode="wait">
      <ResultOverlay
        key={current.matchId}
        moment={current}
        homeCode={code(current.homeTeam)}
        awayCode={code(current.awayTeam)}
        onDone={() => {
          const seen = loadSeen()
          seen.add(current.matchId)
          persistSeen(seen)
          setQueue((prev) => prev.slice(1))
        }}
      />
    </AnimatePresence>
  )
}
