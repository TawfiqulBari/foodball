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
}: {
  match: MatchRow
  teams: Map<number, Team>
  /** This match's picks keyed by market. */
  picks: Map<Market, MatchPick>
  onPick: (market: Market, selection: string) => Promise<void>
}) {
  const [busyMarket, setBusyMarket] = useState<Market | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const home = teams.get(match.home_team)
  const away = teams.get(match.away_team)
  const locked = isLocked(match.kickoff)
  const finished = match.status === 'finished'
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
                selected ? 'bg-navy text-yellow' : 'bg-navy/10 text-navy hover:bg-navy/20'
              }`}
              aria-pressed={selected}
            >
              {busyMarket === 'outcome' && selected ? '…' : labelFor(o)}
            </button>
          )
        })}
      </div>

      {/* Side markets — exact score / BTTS / over-under */}
      {!finished && !locked && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 w-full text-center text-xs font-body font-bold text-teal underline underline-offset-2"
        >
          {expanded ? 'Hide side dishes ▲' : 'Add side dishes — exact score, BTTS, over/under ▼'}
        </button>
      )}

      {expanded && !disabled && (
        <div className="mt-3 space-y-3 border-t border-navy/10 pt-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-navy/50">
              {COPY.fullCourse} — exact score{' '}
              <span className="font-normal normal-case text-navy/40">(+25)</span>
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
        <div className="mt-3 border-t border-navy/10 pt-2 text-center text-sm">
          {outcomePick ? (
            <p className={`font-display ${outcomeCorrect ? 'text-lettuce' : 'text-tomato'}`}>
              {outcomeCorrect ? `${COPY.chefsKiss}! +${outcomePick.points_awarded}` : `${COPY.burntToast}. +0`}
            </p>
          ) : (
            <p className="font-body text-navy/50">{COPY.skippedLunch}</p>
          )}
          <div className="mt-1 flex flex-wrap justify-center gap-1">
            {exactPick && <ResultChip label={COPY.fullCourse} pts={exactPick.points_awarded} />}
            {bttsPick && <ResultChip label="BTTS" pts={bttsPick.points_awarded} />}
            {ouPick && <ResultChip label="O/U" pts={ouPick.points_awarded} />}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-center text-xs text-tomato">{error}</p>}
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
        className="ml-1 min-h-tap rounded-lg bg-navy px-3 font-display text-yellow text-sm active:scale-95 disabled:opacity-40"
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
      <span className="text-[10px] font-bold text-navy/50">{code}</span>
      <div className="flex items-center gap-1">
        <button type="button" onClick={onDec} aria-label={`${code} minus`} className="h-8 w-8 rounded-full bg-navy/10 font-display active:scale-90">
          −
        </button>
        <span className="w-6 text-center font-display text-lg" aria-live="polite">
          {n}
        </span>
        <button type="button" onClick={onInc} aria-label={`${code} plus`} className="h-8 w-8 rounded-full bg-navy/10 font-display active:scale-90">
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
      <p className="text-xs font-bold uppercase tracking-wide text-navy/50">{label}</p>
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
                selected ? 'bg-navy text-yellow' : 'bg-navy/10 text-navy hover:bg-navy/20'
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
        win ? 'bg-lettuce/20 text-lettuce' : 'bg-tomato/15 text-tomato'
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
