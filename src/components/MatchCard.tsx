import { useState } from 'react'
import type { Market, MatchPick, MatchRow, Outcome, Team } from '../lib/database.types'
import { countdownToLock, isLocked, kickoffLabel } from '../lib/format'
import { COPY } from '../lib/copy'

const OUTCOMES: Outcome[] = ['home', 'draw', 'away']

export function MatchCard({
  match,
  teams,
  picks,
  onPick,
  graceActive = false,
}: {
  match: MatchRow
  teams: Map<number, Team>
  /** This match's picks keyed by market. */
  picks: Map<Market, MatchPick>
  onPick: (market: Market, selection: string) => Promise<void>
  /** Launch grace: keep match markets open past kickoff for a still-playable match. */
  graceActive?: boolean
}) {
  const [busyMarket, setBusyMarket] = useState<Market | null>(null)
  const [error, setError] = useState<string | null>(null)

  const home = teams.get(match.home_team)
  const away = teams.get(match.away_team)
  const finished = match.status === 'finished'
  const liveNow = match.status === 'live'
  // Grace reopens a live/upcoming match past kickoff; a finished match never reopens.
  const graceOpen = graceActive && !finished
  const kickoffPassed = isLocked(match.kickoff)
  const locked = graceOpen ? false : kickoffPassed
  const reopenedByGrace = graceOpen && kickoffPassed
  const underdogIsHome = match.underdog_team === match.home_team
  const underdogIsAway = match.underdog_team === match.away_team

  const outcomePick = picks.get('outcome')
  const exactPick = picks.get('exact_score')
  const bttsPick = picks.get('btts')
  const ouPick = picks.get('over_under')

  async function choose(market: Market, selection: string) {
    setError(null)
    setBusyMarket(market)
    try {
      await onPick(market, selection)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save pick')
    } finally {
      setBusyMarket(null)
    }
  }

  const labelFor = (o: Outcome) =>
    o === 'home' ? home?.fifa_code ?? 'Home' : o === 'away' ? away?.fifa_code ?? 'Away' : 'Draw'
  const outcomeCorrect = finished && outcomePick && (outcomePick.points_awarded ?? 0) > 0
  const disabled = locked || finished

  return (
    <div className="rounded-card bg-card text-card-foreground p-4 shadow-sm border border-border">
      <div className="flex items-center justify-between text-xs font-body text-muted-foreground">
        <span>
          {match.group_letter ? `Group ${match.group_letter} · ` : ''}
          {kickoffLabel(match.kickoff)}
        </span>
        {finished ? (
          <span className="font-semibold text-foreground">FT</span>
        ) : liveNow ? (
          <span className="font-semibold text-destructive animate-pulse">● LIVE</span>
        ) : locked ? (
          <span className="font-semibold text-destructive">Locked</span>
        ) : (
          <span className="font-semibold text-primary">⏱ {countdownToLock(match.kickoff)}</span>
        )}
      </div>

      {reopenedByGrace && (
        <p className="mt-2 rounded-lg bg-primary/10 border border-primary/30 px-3 py-1.5 text-center text-[11px] font-body text-foreground">
          🍳 <span className="font-bold">Late launch</span> — picks still open for this match.
        </p>
      )}

      <div className="my-3 flex items-center justify-center gap-3 text-lg font-display">
        <span className="flex items-center gap-1">
          {home?.flag_emoji} {home?.fifa_code}
          {underdogIsHome && <Tag />}
        </span>
        {finished || liveNow ? (
          <span className={`px-2 text-2xl ${liveNow ? 'text-destructive' : ''}`}>
            {match.home_score ?? 0}–{match.away_score ?? 0}
          </span>
        ) : (
          <span className="px-2 text-muted-foreground">vs</span>
        )}
        <span className="flex items-center gap-1">
          {away?.fifa_code} {away?.flag_emoji}
          {underdogIsAway && <Tag />}
        </span>
      </div>

      {/* Outcome — the headline market (10 pts, ×2 on an underdog) */}
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Outcome pick">
        {OUTCOMES.map((o) => {
          const selected = outcomePick?.selection === o
          return (
            <button
              key={o}
              type="button"
              disabled={disabled || busyMarket !== null}
              onClick={() => void choose('outcome', o)}
              className={`min-h-tap rounded-lg px-2 py-2 text-sm font-body font-bold transition active:scale-95 disabled:opacity-50 ${
                selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'
              }`}
              aria-pressed={selected}
            >
              {busyMarket === 'outcome' && selected ? '…' : labelFor(o)}
            </button>
          )
        })}
      </div>

      {/* Side dishes — exact score / BTTS / over-under (always shown while open) */}
      {!disabled && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          <p className="text-center text-[11px] font-body font-bold uppercase tracking-wide text-muted-foreground">
            Side dishes
          </p>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {COPY.fullCourse} — exact score{' '}
              <span className="font-normal normal-case text-muted-foreground">(+25)</span>
            </p>
            <ExactScoreStepper
              key={exactPick?.selection ?? 'new'} /* remount if the stored pick changes (e.g. server correction) */
              value={exactPick?.selection}
              busy={busyMarket === 'exact_score'}
              homeCode={home?.fifa_code ?? 'H'}
              awayCode={away?.fifa_code ?? 'A'}
              onSubmit={(sel) => void choose('exact_score', sel)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Toggle
              label="Both teams score (5)"
              options={[
                ['yes', 'Yes'],
                ['no', 'No'],
              ]}
              value={bttsPick?.selection}
              busy={busyMarket === 'btts'}
              onChoose={(s) => void choose('btts', s)}
            />
            <Toggle
              label="Goals o/u 2.5 (5)"
              options={[
                ['over', 'Over'],
                ['under', 'Under'],
              ]}
              value={ouPick?.selection}
              busy={busyMarket === 'over_under'}
              onChoose={(s) => void choose('over_under', s)}
            />
          </div>
        </div>
      )}

      {/* Result summary */}
      {finished && (
        <div className="mt-3 border-t border-border pt-2 text-center text-sm">
          {outcomePick ? (
            <p className={`font-display ${outcomeCorrect ? 'text-lettuce' : 'text-destructive'}`}>
              {outcomeCorrect ? `${COPY.chefsKiss}! +${outcomePick.points_awarded}` : `${COPY.burntToast}. +0`}
            </p>
          ) : (
            <p className="font-body text-muted-foreground">{COPY.skippedLunch}</p>
          )}
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {exactPick && <ResultChip label={COPY.fullCourse} pts={exactPick.points_awarded} />}
            {bttsPick && <ResultChip label="BTTS" pts={bttsPick.points_awarded} />}
            {ouPick && <ResultChip label="O/U" pts={ouPick.points_awarded} />}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
    </div>
  )
}

function ExactScoreStepper({
  value,
  busy,
  homeCode,
  awayCode,
  onSubmit,
}: {
  value?: string
  busy: boolean
  homeCode: string
  awayCode: string
  onSubmit: (selection: string) => void
}) {
  const [h, setH] = useState(() => Number(value?.split('-')[0] ?? 0))
  const [a, setA] = useState(() => Number(value?.split('-')[1] ?? 0))
  const dirty = value !== `${h}-${a}`
  const step = (setter: (n: number) => void, cur: number, d: number) =>
    setter(Math.max(0, Math.min(9, cur + d)))

  return (
    <div className="mt-1 flex items-center justify-center gap-3 font-body">
      <Stepper code={homeCode} n={h} onDec={() => step(setH, h, -1)} onInc={() => step(setH, h, 1)} />
      <span className="font-display text-lg">–</span>
      <Stepper code={awayCode} n={a} onDec={() => step(setA, a, -1)} onInc={() => step(setA, a, 1)} />
      <button
        type="button"
        disabled={busy || !dirty}
        onClick={() => onSubmit(`${h}-${a}`)}
        className="ml-1 min-h-tap rounded-lg bg-primary px-3 font-display text-primary-foreground text-sm active:scale-95 disabled:opacity-40"
      >
        {busy ? '…' : dirty ? 'Set' : 'Set ✓'}
      </button>
    </div>
  )
}

function Stepper({
  code,
  n,
  onDec,
  onInc,
}: {
  code: string
  n: number
  onDec: () => void
  onInc: () => void
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] font-bold text-muted-foreground">{code}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDec} aria-label={`${code} minus`} className="h-8 w-8 rounded-full bg-muted font-display active:scale-90 hover:bg-accent">
          −
        </button>
        <span className="w-6 text-center font-display text-lg" aria-live="polite">
          {n}
        </span>
        <button type="button" onClick={onInc} aria-label={`${code} plus`} className="h-8 w-8 rounded-full bg-muted font-display active:scale-90 hover:bg-accent">
          +
        </button>
      </div>
    </div>
  )
}

function Toggle({
  label,
  options,
  value,
  busy,
  onChoose,
}: {
  label: string
  options: [string, string][]
  value?: string
  busy: boolean
  onChoose: (selection: string) => void
}) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 grid grid-cols-2 gap-1" role="group" aria-label={label}>
        {options.map(([val, lbl]) => {
          const selected = value === val
          return (
            <button
              key={val}
              type="button"
              disabled={busy}
              onClick={() => onChoose(val)}
              aria-pressed={selected}
              className={`min-h-tap rounded-lg py-1.5 text-sm font-body font-bold transition active:scale-95 disabled:opacity-50 ${
                selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-accent'
              }`}
            >
              {lbl}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ResultChip({ label, pts }: { label: string; pts: number | null }) {
  const win = (pts ?? 0) > 0
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
        win ? 'bg-lettuce/20 text-lettuce' : 'bg-destructive/15 text-destructive'
      }`}
    >
      {label} {win ? `+${pts}` : '+0'}
    </span>
  )
}

function Tag() {
  return (
    <span className="rounded bg-bun px-1 text-[10px] font-body font-bold text-navy" title="Designated underdog — outcome points ×2">
      ×2
    </span>
  )
}
