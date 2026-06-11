import { useEffect, useState } from 'react'
import { fetchMyPicks, fetchTeams } from '../lib/api'
import type { MatchPick, Team } from '../lib/database.types'
import { supabase } from '../lib/supabase'
import type { MatchRow } from '../lib/database.types'
import { COPY } from '../lib/copy'
import { kickoffLabel } from '../lib/format'

interface Row {
  pick: MatchPick
  match: MatchRow
}

export function MyPicks() {
  const [rows, setRows] = useState<Row[]>([])
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const [pickMap, teamMap] = await Promise.all([fetchMyPicks(), fetchTeams()])
      const picks = [...pickMap.values()].filter((p) => p.market === 'outcome')
      const ids = [...new Set(picks.map((p) => p.match_id))]
      const matches = ids.length
        ? (await supabase.from('matches').select('*').in('id', ids)).data ?? []
        : []
      const byId = new Map(matches.map((m) => [m.id, m]))
      setRows(
        picks
          .map((p) => ({ pick: p, match: byId.get(p.match_id) }))
          .filter((r): r is Row => Boolean(r.match)),
      )
      setTeams(teamMap)
      setLoading(false)
    }
    void load()
  }, [])

  return (
    <div className="px-4 pt-3 pb-24">
      <h1 className="font-display text-2xl text-yellow">My Picks</h1>
      <p className="font-body text-bunlight/60 text-sm">
        Tournament-long picks (Champion, Golden Boot…) with decay land in Milestone 2.
      </p>
      {loading ? (
        <p className="mt-8 text-center font-body text-bunlight/60">Reading your order…</p>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-center font-body text-bunlight/60">{COPY.emptyMatches}</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {rows.map(({ pick, match }) => {
            const home = teams.get(match.home_team)
            const away = teams.get(match.away_team)
            const settled = match.status === 'finished'
            const won = (pick.points_awarded ?? 0) > 0
            return (
              <li key={pick.id} className="rounded-card bg-bunlight/95 text-navy px-4 py-3 font-body">
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {home?.flag_emoji} {home?.fifa_code} vs {away?.fifa_code} {away?.flag_emoji}
                  </span>
                  <span className="text-xs text-navy/50">{kickoffLabel(match.kickoff)}</span>
                </div>
                <div className="mt-1 text-sm">
                  Picked: <strong>{pick.selection}</strong>
                  {settled && (
                    <span className={`ml-2 font-display ${won ? 'text-lettuce' : 'text-tomato'}`}>
                      {won ? `${COPY.chefsKiss} +${pick.points_awarded}` : COPY.burntToast}
                    </span>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
