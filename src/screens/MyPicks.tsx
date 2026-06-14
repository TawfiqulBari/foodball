import { useEffect, useMemo, useState } from 'react'
import {
  fetchDecaySchedule,
  fetchLongshotGrace,
  fetchMyTourneyPicks,
  fetchPlayers,
  fetchRounds,
  fetchTeams,
  isRevisionWindowOpen,
  setTourneyPick,
} from '../lib/api'
import type {
  DecayRow,
  PlayerCatalog,
  RoundRow,
  Team,
  TourneyPick,
  TourneyPickType,
} from '../lib/database.types'
import { decayBucket, decayedPoints } from '../lib/decay'
import { COPY } from '../lib/copy'

type Kind = 'team' | 'player' | 'number'
type Meta = { type: TourneyPickType; label: string; kind: Kind; positions?: string[] }
const PICK_META: Meta[] = [
  { type: 'champion', label: 'Champion 🏆', kind: 'team' },
  { type: 'finalist', label: 'A finalist 🥈', kind: 'team' },
  { type: 'golden_boot', label: 'Golden Boot 👟', kind: 'player' },
  // Golden Glove is a keeper award — only offer goalkeepers.
  { type: 'golden_glove', label: 'Golden Glove 🧤', kind: 'player', positions: ['GK'] },
  { type: 'young_player', label: 'Best Young Player ⭐', kind: 'player' },
  { type: 'total_goals', label: 'Total tournament goals', kind: 'number' },
]

export function MyPicks() {
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [players, setPlayers] = useState<PlayerCatalog[]>([])
  const [schedule, setSchedule] = useState<DecayRow[]>([])
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [picks, setPicks] = useState<TourneyPick[]>([])
  const [windowOpen, setWindowOpen] = useState(false)
  const [graceUntil, setGraceUntil] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  async function reload() {
    const [t, p, s, r, tp, open, grace] = await Promise.all([
      fetchTeams(),
      fetchPlayers(),
      fetchDecaySchedule(),
      fetchRounds(),
      fetchMyTourneyPicks(),
      isRevisionWindowOpen(),
      fetchLongshotGrace(),
    ])
    setTeams(t)
    setPlayers(p)
    setSchedule(s)
    setRounds(r)
    setPicks(tp)
    setWindowOpen(open)
    setGraceUntil(grace)
  }

  useEffect(() => {
    reload()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [])

  // Active pick per type = the newest row of that type (fetch is newest-first).
  const active = useMemo(() => {
    const m = new Map<TourneyPickType, TourneyPick>()
    for (const p of picks) if (!m.has(p.pick_type)) m.set(p.pick_type, p)
    return m
  }, [picks])

  const latestCompleted = useMemo(() => {
    const done = rounds.filter((r) => r.completed).sort((a, b) => b.sort_order - a.sort_order)
    return done[0]?.key ?? null
  }, [rounds])
  // During the launch grace window, a pick is stamped pre-tournament (full value),
  // so the "worth N pts" preview should reflect the null bucket too.
  const graceActive = graceUntil != null && new Date(graceUntil).getTime() > Date.now()
  const nowBucket = graceActive ? null : decayBucket(latestCompleted)
  const graceDate = graceUntil
    ? new Date(graceUntil).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div className="px-4 pt-3 pb-24">
      <h1 className="font-display text-2xl text-primary">My Picks</h1>
      {err && <p className="text-destructive text-sm font-body">{err}</p>}

      <div
        className={`mt-2 rounded-card px-4 py-2 text-sm font-body ${
          graceActive
            ? 'bg-primary/15 text-primary font-semibold'
            : windowOpen
              ? 'bg-lettuce/20 text-lettuce'
              : 'bg-card text-muted-foreground shadow-sm border border-border'
        }`}
      >
        {graceActive
          ? `🍳 Kitchen's still open! Set your long shots at full value until ${graceDate}.`
          : windowOpen
            ? '🔓 Revision window OPEN — change your long shots before the next round kicks off.'
            : '🔒 Long shots are locked — a round is in progress. They reopen between rounds.'}
      </div>

      {loading ? (
        <p className="mt-8 text-center font-body text-muted-foreground">Reading your order…</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {PICK_META.map((meta) => (
            <TourneyPickRow
              key={meta.type}
              meta={meta}
              teams={teams}
              players={players}
              schedule={schedule}
              nowBucket={nowBucket}
              activePick={active.get(meta.type)}
              history={picks.filter((p) => p.pick_type === meta.type)}
              windowOpen={windowOpen}
              onSet={async (selection) => {
                await setTourneyPick(meta.type, selection)
                await reload()
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function TourneyPickRow({
  meta,
  teams,
  players,
  schedule,
  nowBucket,
  activePick,
  history,
  windowOpen,
  onSet,
}: {
  meta: Meta
  teams: Map<number, Team>
  players: PlayerCatalog[]
  schedule: DecayRow[]
  nowBucket: string | null
  activePick?: TourneyPick
  history: TourneyPick[]
  windowOpen: boolean
  onSet: (selection: string) => Promise<void>
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  const label = (sel: string): string => {
    if (meta.kind === 'team') return teams.get(Number(sel))?.name ?? sel
    if (meta.kind === 'player') {
      const p = players.find((p) => String(p.id) === sel)
      if (!p) return sel
      const t = p.team != null ? teams.get(p.team) : undefined
      return t ? `${p.name} (${t.fifa_code})` : p.name
    }
    return sel
  }

  const settled = activePick && activePick.points_awarded !== null
  const currentWorth = activePick
    ? decayedPoints(schedule, meta.type, activePick.set_after_round)
    : decayedPoints(schedule, meta.type, nowBucket)
  const loyal = meta.type === 'champion' && activePick && history.length === 1

  const teamOpts = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name))
  // Players grouped by nation, then name — a flat 48-team list is easier to scan
  // when teammates sit together and each option carries its country. Award-specific
  // position filter (e.g. Golden Glove → goalkeepers only).
  const playerOpts = players
    .filter((p) => !meta.positions || (p.position != null && meta.positions.includes(p.position)))
    .slice()
    .sort((a, b) => {
    const ta = a.team != null ? teams.get(a.team)?.name ?? '' : ''
    const tb = b.team != null ? teams.get(b.team)?.name ?? '' : ''
    return ta.localeCompare(tb) || a.name.localeCompare(b.name)
  })

  async function submit() {
    if (!draft) return
    setErr(null)
    setBusy(true)
    try {
      await onSet(draft)
      setDraft('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-card bg-card text-foreground shadow-sm p-4 font-body">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg">{meta.label}</span>
        {settled ? (
          <span className={`font-display ${(activePick!.points_awarded ?? 0) > 0 ? 'text-lettuce' : 'text-destructive'}`}>
            {(activePick!.points_awarded ?? 0) > 0 ? `+${activePick!.points_awarded}` : '+0'}
          </span>
        ) : (
          <span className="text-xs font-bold text-bun" title="Worth this many points if correct, at the current decay">
            worth {currentWorth} pts
          </span>
        )}
      </div>

      <p className="mt-1 text-sm">
        {activePick ? (
          <>
            Picked: <strong>{label(activePick.selection)}</strong>{' '}
            {loyal && (
              <span className="ml-1 rounded-full bg-bun/30 px-2 text-[11px] font-bold text-navy" title="Never switched">
                🛡️ Loyal
              </span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">{COPY.skippedLunch} — no pick yet.</span>
        )}
      </p>

      {windowOpen && !settled && (
        <div className="mt-2 flex items-center gap-2">
          {meta.kind === 'number' ? (
            <input
              inputMode="numeric"
              maxLength={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
              placeholder="e.g. 160"
              className="min-h-tap w-28 rounded-lg bg-background border border-input px-3 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={meta.label}
            />
          ) : (
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-tap flex-1 rounded-lg bg-background border border-input px-3 text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={meta.label}
            >
              <option value="" disabled>
                Choose…
              </option>
              {meta.kind === 'team'
                ? teamOpts.map((t) => (
                    <option key={t.id} value={String(t.id)}>
                      {t.flag_emoji} {t.name}
                    </option>
                  ))
                : players.length === 0
                  ? <option value="" disabled>Squads not synced yet</option>
                  : playerOpts.map((p) => {
                      const t = p.team != null ? teams.get(p.team) : undefined
                      return (
                        <option key={p.id} value={String(p.id)}>
                          {t ? `${t.flag_emoji} ` : ''}
                          {p.name}
                          {t ? ` · ${t.fifa_code}` : ''}
                        </option>
                      )
                    })}
            </select>
          )}
          <button
            type="button"
            disabled={busy || !draft}
            onClick={() => void submit()}
            className="min-h-tap rounded-lg bg-primary px-4 font-display text-primary-foreground active:scale-95 disabled:opacity-40"
          >
            {busy ? '…' : activePick ? 'Revise' : 'Set'}
          </button>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs font-bold text-primary underline underline-offset-2"
          >
            {showHistory ? 'Hide history ▲' : `Revision history (${history.length}) ▼`}
          </button>
          {showHistory && (
            <ol className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {history.map((h, i) => (
                <li key={h.id}>
                  {i === 0 ? '➡️ ' : '• '}
                  {label(h.selection)} —{' '}
                  <span className="italic">{h.set_after_round ? `after ${h.set_after_round}` : 'pre-tournament'}</span>{' '}
                  <span className="text-muted-foreground">{new Date(h.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </li>
  )
}
