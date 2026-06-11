import { useState } from 'react'
import type { MatchRow, PlayerCatalog, Prop, RoundProp, Team } from '../lib/database.types'
import { isLocked } from '../lib/format'
import { COPY } from '../lib/copy'

/** "Top Chef / Clean Plate / Spice of the Round" props (spec §4.2). They lock at
 *  the round's first kickoff; settle when the round completes. */
export function RoundPropsCard({
  roundFirstKickoff,
  matches,
  teams,
  players,
  myProps,
  onSubmit,
}: {
  roundFirstKickoff: string | null
  matches: MatchRow[]
  teams: Map<number, Team>
  players: PlayerCatalog[]
  myProps: Map<Prop, RoundProp>
  onSubmit: (prop: Prop, selection: string) => Promise<void>
}) {
  const [busy, setBusy] = useState<Prop | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const locked = roundFirstKickoff ? isLocked(roundFirstKickoff) : false
  const keepers = players.filter((p) => (p.position ?? '').toUpperCase().startsWith('G'))
  const upsetMatches = matches.filter((m) => m.underdog_team)

  async function choose(prop: Prop, selection: string) {
    if (!selection) return
    setErr(null)
    setBusy(prop)
    try {
      await onSubmit(prop, selection)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(null)
    }
  }

  const teamLabel = (id: number | null) => {
    const t = id ? teams.get(id) : undefined
    return t ? `${t.flag_emoji ?? ''} ${t.fifa_code}` : '—'
  }
  const matchLabel = (m: MatchRow) =>
    `${teamLabel(m.home_team)} v ${teamLabel(m.away_team)} (underdog ${teamLabel(m.underdog_team)})`

  return (
    <div className="rounded-card bg-white text-ink shadow-sm ring-1 ring-orange/40 p-4 mb-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-orange text-lg">Round specials 🍽️</h2>
        {locked && <span className="text-xs font-body text-tomato">Locked</span>}
      </div>
      <p className="text-xs font-body text-ink/60">
        Lock at the round's first kickoff. Settle when the round finishes.
      </p>

      <PropRow
        title={`${COPY.spice} (20)`}
        hint="Pick a match where the underdog wins."
        prop="spice"
        locked={locked}
        busy={busy === 'spice'}
        current={myProps.get('spice')}
        currentLabel={(sel) => {
          const m = matches.find((x) => String(x.id) === sel)
          return m ? matchLabel(m) : sel
        }}
        options={upsetMatches.map((m) => ({ value: String(m.id), label: matchLabel(m) }))}
        emptyNote="No underdog matches set for this round yet."
        onChoose={(s) => choose('spice', s)}
      />

      <PropRow
        title={`${COPY.cleanPlate} (10)`}
        hint="Pick a goalkeeper; points if their team keeps a clean sheet."
        prop="clean_plate"
        locked={locked}
        busy={busy === 'clean_plate'}
        current={myProps.get('clean_plate')}
        currentLabel={(sel) => players.find((p) => String(p.id) === sel)?.name ?? sel}
        options={keepers.map((p) => ({ value: String(p.id), label: `${p.name} · ${teamLabel(p.team)}` }))}
        emptyNote="Squad keepers load once the admin syncs squads."
        onChoose={(s) => choose('clean_plate', s)}
      />

      <PropRow
        title={`${COPY.topChef} (15)`}
        hint="Pick the round's top scorer."
        prop="top_chef"
        locked={locked}
        busy={busy === 'top_chef'}
        current={myProps.get('top_chef')}
        currentLabel={(sel) => players.find((p) => String(p.id) === sel)?.name ?? sel}
        options={players.map((p) => ({ value: String(p.id), label: `${p.name} · ${teamLabel(p.team)}` }))}
        emptyNote="Squads load once the admin syncs them."
        onChoose={(s) => choose('top_chef', s)}
      />

      {err && <p className="mt-2 text-xs text-tomato font-body">{err}</p>}
    </div>
  )
}

function PropRow({
  title,
  hint,
  locked,
  busy,
  current,
  currentLabel,
  options,
  emptyNote,
  onChoose,
}: {
  title: string
  hint: string
  prop: Prop
  locked: boolean
  busy: boolean
  current?: RoundProp
  currentLabel: (sel: string) => string
  options: { value: string; label: string }[]
  emptyNote: string
  onChoose: (selection: string) => void
}) {
  const settled = current && current.points_awarded !== null
  return (
    <div className="mt-3 border-t border-ink/10 pt-2">
      <div className="flex items-center justify-between">
        <span className="font-display text-ink">{title}</span>
        {settled && (
          <span className={`text-xs font-bold ${(current!.points_awarded ?? 0) > 0 ? 'text-lettuce' : 'text-tomato'}`}>
            {(current!.points_awarded ?? 0) > 0 ? `+${current!.points_awarded}` : '+0'}
          </span>
        )}
      </div>
      <p className="text-xs font-body text-ink/50">{hint}</p>

      {locked ? (
        <p className="mt-1 text-sm font-body text-ink/80">
          {current ? currentLabel(current.selection) : <span className="text-ink/40">{COPY.skippedLunch}</span>}
        </p>
      ) : options.length === 0 ? (
        <p className="mt-1 text-xs font-body text-ink/40 italic">{emptyNote}</p>
      ) : (
        <select
          disabled={busy}
          value={current?.selection ?? ''}
          onChange={(e) => onChoose(e.target.value)}
          className="mt-1 w-full min-h-tap rounded-lg bg-white px-3 text-ink font-body text-sm ring-1 ring-ink/10 focus:ring-orange disabled:opacity-60"
        >
          <option value="" disabled>
            {busy ? 'Saving…' : 'Choose…'}
          </option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
