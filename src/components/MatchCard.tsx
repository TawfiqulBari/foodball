import { useState } from 'react'
import type { MatchPick, MatchRow, Outcome, Team } from '../lib/database.types'
import { countdownToLock, isLocked, kickoffLabel } from '../lib/format'
import { COPY } from '../lib/copy'

const OUTCOMES: Outcome[] = ['home', 'draw', 'away']

export function MatchCard({
  match,
  teams,
  pick,
  onPick,
}: {
  match: MatchRow
  teams: Map<number, Team>
  pick?: MatchPick
  onPick: (matchId: number, selection: Outcome) => Promise<void>
}) {
  const [saving, setSaving] = useState<Outcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const home = teams.get(match.home_team)
  const away = teams.get(match.away_team)
  const locked = isLocked(match.kickoff)
  const finished = match.status === 'finished'
  const underdogIsHome = match.underdog_team === match.home_team
  const underdogIsAway = match.underdog_team === match.away_team

  async function choose(sel: Outcome) {
    setError(null)
    setSaving(sel)
    try {
      await onPick(match.id, sel)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save pick')
    } finally {
      setSaving(null)
    }
  }

  const labelFor = (o: Outcome) =>
    o === 'home' ? home?.fifa_code ?? 'Home' : o === 'away' ? away?.fifa_code ?? 'Away' : 'Draw'

  const correct = finished && pick && (pick.points_awarded ?? 0) > 0

  return (
    <div className="rounded-card bg-bunlight text-navy p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs font-body text-navy/60">
        <span>
          {match.group_letter ? `Group ${match.group_letter} · ` : ''}
          {kickoffLabel(match.kickoff)}
        </span>
        {finished ? (
          <span className="font-semibold text-navy">FT</span>
        ) : locked ? (
          <span className="font-semibold text-tomato">Locked</span>
        ) : (
          <span className="font-semibold text-teal">⏱ {countdownToLock(match.kickoff)}</span>
        )}
      </div>

      <div className="my-3 flex items-center justify-center gap-3 text-lg font-display">
        <span className="flex items-center gap-1">
          {home?.flag_emoji} {home?.fifa_code}
          {underdogIsHome && <Tag />}
        </span>
        {finished ? (
          <span className="px-2 text-2xl">
            {match.home_score}–{match.away_score}
          </span>
        ) : (
          <span className="px-2 text-navy/40">vs</span>
        )}
        <span className="flex items-center gap-1">
          {away?.fifa_code} {away?.flag_emoji}
          {underdogIsAway && <Tag />}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Outcome pick">
        {OUTCOMES.map((o) => {
          const selected = pick?.selection === o
          return (
            <button
              key={o}
              type="button"
              disabled={locked || saving !== null}
              onClick={() => void choose(o)}
              className={`min-h-tap rounded-lg px-2 py-2 text-sm font-body font-bold transition active:scale-95 disabled:opacity-50 ${
                selected ? 'bg-navy text-yellow' : 'bg-navy/10 text-navy hover:bg-navy/20'
              }`}
              aria-pressed={selected}
            >
              {saving === o ? '…' : labelFor(o)}
            </button>
          )
        })}
      </div>

      {finished && pick && (
        <p className={`mt-2 text-center text-sm font-display ${correct ? 'text-lettuce' : 'text-tomato'}`}>
          {correct ? `${COPY.chefsKiss}! +${pick.points_awarded}` : `${COPY.burntToast}. +0`}
        </p>
      )}
      {finished && !pick && (
        <p className="mt-2 text-center text-sm font-body text-navy/50">{COPY.skippedLunch}</p>
      )}
      {error && <p className="mt-2 text-center text-xs text-tomato">{error}</p>}
    </div>
  )
}

function Tag() {
  return (
    <span className="rounded bg-bun px-1 text-[10px] font-body font-bold text-navy" title="Designated underdog — outcome points ×2">
      ×2
    </span>
  )
}
