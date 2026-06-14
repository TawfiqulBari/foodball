import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useAuth } from '../auth/AuthProvider'
import {
  adminAddSignupDomain,
  adminPostCommentary,
  adminRemoveSignupDomain,
  adminSetLongshotGrace,
  adminSetResult,
  adminSetRoundPropsGrace,
  adminSetTournamentResult,
  adminSetUnderdog,
  adminSettleRound,
  adminUpdateDecay,
  fetchDecaySchedule,
  fetchLongshotGrace,
  fetchRoundPropsGrace,
  fetchSignupDomains,
  fetchMatches,
  fetchPlayers,
  fetchRounds,
  fetchTeams,
} from '../lib/api'
import type { DecayRow, MatchRow, PlayerCatalog, RoundRow, Team } from '../lib/database.types'
import { DECAY_BUCKETS, TOURNEY_PICK_LABELS } from '../lib/scoring'
import { kickoffLabel } from '../lib/format'

const scoreSchema = z.coerce.number().int().min(0).max(99)

export function Admin() {
  const { profile } = useAuth()
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [round, setRound] = useState('MD1')
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [players, setPlayers] = useState<PlayerCatalog[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchRounds(), fetchTeams(), fetchPlayers()]).then(([r, t, p]) => {
      setRounds(r)
      setTeams(t)
      setPlayers(p)
    })
  }, [])
  useEffect(() => {
    fetchMatches(round).then(setMatches)
  }, [round])

  if (!profile?.is_admin) {
    return <p className="px-4 pt-8 text-center font-body text-destructive">Admins only — this kitchen is staff-only.</p>
  }
  const refresh = () => fetchMatches(round).then(setMatches)
  const isKnockout = !['MD1', 'MD2', 'MD3'].includes(round)

  return (
    <div className="px-4 pt-3 pb-24 font-body text-foreground space-y-6">
      <div>
        <h1 className="font-display text-2xl text-primary">Admin · Kitchen pass</h1>
        <p className="text-xs text-muted-foreground">Manual results always win over the API feed (spec §6.5).</p>
        {msg && <p className="mt-2 text-lettuce text-sm">{msg}</p>}
      </div>

      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {rounds.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRound(r.key)}
            className={`shrink-0 min-h-tap rounded-full px-3 text-sm font-display ${
              round === r.key ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground border border-border'
            }`}
          >
            {r.key}
            {r.completed && ' ✓'}
          </button>
        ))}
      </div>

      {/* Launch tools: long-shot grace window + celebration smoke test */}
      <LaunchTools onSaved={setMsg} />

      {/* Results + underdog */}
      <section>
        <h2 className="font-display text-lg text-primary">Results &amp; underdogs — {round}</h2>
        <ul className="mt-2 space-y-3">
          {matches.map((m) => (
            <AdminMatchRow
              key={m.id}
              match={m}
              teams={teams}
              isKnockout={isKnockout}
              onSaved={setMsg}
              onRefresh={refresh}
            />
          ))}
          {matches.length === 0 && <li className="text-sm text-muted-foreground">No fixtures seeded for {round}.</li>}
        </ul>
      </section>

      {/* Round settle (Top Chef scorers + complete) */}
      <SettleRound round={round} players={players} teams={teams} onSaved={setMsg} onRefresh={() => fetchRounds().then(setRounds)} />

      {/* Tournament results */}
      <TournamentResults teams={teams} players={players} onSaved={setMsg} />

      {/* Decay editor */}
      <DecayEditor onSaved={setMsg} />
    </div>
  )
}

function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function GraceControl({
  label,
  help,
  load,
  store,
  noun,
  onSaved,
}: {
  label: string
  help: string
  load: () => Promise<string | null>
  store: (until: string | null) => Promise<void>
  noun: string
  onSaved: (m: string) => void
}) {
  const [until, setUntil] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    load()
      .then((g) => g && setUntil(toLocalInput(g)))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(clear: boolean) {
    setBusy(true)
    try {
      await store(clear ? null : until ? new Date(until).toISOString() : null)
      onSaved(clear ? `${noun} cleared.` : `${noun} saved.`)
      if (clear) setUntil('')
    } catch (e) {
      onSaved(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label className="text-xs font-semibold text-muted-foreground">{label}</label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          type="datetime-local"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          className="min-h-tap rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          disabled={busy || !until}
          onClick={() => void save(false)}
          className="min-h-tap rounded-lg bg-primary px-3 font-display text-sm text-primary-foreground active:scale-95 disabled:opacity-50"
        >
          Set
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(true)}
          className="min-h-tap rounded-lg border border-border px-3 text-sm text-muted-foreground active:scale-95"
        >
          Clear
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{help}</p>
    </div>
  )
}

function SignupDomains({ onSaved }: { onSaved: (m: string) => void }) {
  const [domains, setDomains] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = () =>
    fetchSignupDomains()
      .then(setDomains)
      .catch(() => {})
  useEffect(() => {
    void reload()
  }, [])

  async function add() {
    if (!input.trim()) return
    setBusy(true)
    try {
      await adminAddSignupDomain(input)
      setInput('')
      await reload()
      onSaved('Signup domain added.')
    } catch (e) {
      onSaved(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  async function remove(d: string) {
    setBusy(true)
    try {
      await adminRemoveSignupDomain(d)
      await reload()
      onSaved(`Removed ${d}.`)
    } catch (e) {
      onSaved(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-border pt-3">
      <label className="text-xs font-semibold text-muted-foreground">Who can sign up — allowed email domains</label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {domains.length === 0 ? (
          <span className="text-xs font-body text-destructive">⚠ No allowlist — anyone can sign up.</span>
        ) : (
          domains.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-body text-foreground">
              @{d}
              <button
                type="button"
                disabled={busy}
                onClick={() => void remove(d)}
                aria-label={`remove ${d}`}
                className="text-muted-foreground hover:text-destructive"
              >
                ✕
              </button>
            </span>
          ))
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder="company.com"
          className="min-h-tap rounded-lg border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="button"
          disabled={busy || !input.trim()}
          onClick={() => void add()}
          className="min-h-tap rounded-lg bg-primary px-3 font-display text-sm text-primary-foreground active:scale-95 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Only these domains can register (enforced server-side). Empty = open to anyone.
      </p>
    </div>
  )
}

function LaunchTools({ onSaved }: { onSaved: (m: string) => void }) {
  return (
    <section>
      <h2 className="font-display text-lg text-primary">Launch tools</h2>
      <div className="mt-2 space-y-3 rounded-card border border-border bg-card p-3 text-foreground shadow-sm">
        <GraceControl
          label="Long-shot grace — full value until"
          help="While active, everyone can set/change tournament long shots at full pre-tournament value."
          load={fetchLongshotGrace}
          store={adminSetLongshotGrace}
          noun="Long-shot grace"
          onSaved={onSaved}
        />

        <div className="border-t border-border pt-3">
          <GraceControl
            label="Round-specials grace — open until"
            help="While active, Top Chef / Clean Plate / Spice stay open for everyone even after the round's first kickoff."
            load={fetchRoundPropsGrace}
            store={adminSetRoundPropsGrace}
            noun="Round-specials grace"
            onSaved={onSaved}
          />
        </div>

        <div className="border-t border-border pt-3">
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('fb:test-celebration'))}
            className="min-h-tap rounded-lg bg-primary px-4 font-display text-sm text-primary-foreground active:scale-95"
          >
            Test celebration overlays
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            Plays Chef’s Kiss → Full Course → Spicy ×2 → Burnt Toast locally (no DB write) to verify queueing + reduced-motion.
          </p>
        </div>

        <SignupDomains onSaved={onSaved} />
      </div>
    </section>
  )
}

function AdminMatchRow({
  match,
  teams,
  isKnockout,
  onSaved,
  onRefresh,
}: {
  match: MatchRow
  teams: Map<number, Team>
  isKnockout: boolean
  onSaved: (msg: string) => void
  onRefresh: () => void
}) {
  const home = teams.get(match.home_team)
  const away = teams.get(match.away_team)
  const [h, setH] = useState(String(match.home_score ?? ''))
  const [a, setA] = useState(String(match.away_score ?? ''))
  const [winner, setWinner] = useState<string>(match.winner ? String(match.winner) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    setErr(null)
    const hp = scoreSchema.safeParse(h)
    const ap = scoreSchema.safeParse(a)
    if (!hp.success || !ap.success) {
      setErr('Scores must be whole numbers 0–99.')
      return
    }
    // Group stage: draw allowed (null winner). Knockout: a tie needs an explicit
    // winner (penalties); otherwise derive it from the score.
    let win: number | null
    if (winner) win = Number(winner)
    else if (hp.data > ap.data) win = match.home_team
    else if (ap.data > hp.data) win = match.away_team
    else win = null
    if (isKnockout && win === null) {
      setErr('Knockout: choose the winner (penalties).')
      return
    }
    setBusy(true)
    try {
      await adminSetResult({ matchId: match.id, home: hp.data, away: ap.data, winner: win })
      onSaved(`Saved ${home?.fifa_code} ${hp.data}–${ap.data} ${away?.fifa_code} · scored.`)
      onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  async function setDog(teamId: number | null) {
    try {
      await adminSetUnderdog(match.id, teamId)
      onSaved('Underdog updated.')
      onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <li className="rounded-card bg-card text-foreground shadow-sm p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-bold">
          {home?.flag_emoji} {home?.fifa_code} vs {away?.fifa_code} {away?.flag_emoji}
        </span>
        <span className="text-xs text-muted-foreground">{kickoffLabel(match.kickoff)} · {match.status}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input aria-label={`${home?.fifa_code} score`} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} className="w-12 min-h-tap rounded text-center bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        <span>–</span>
        <input aria-label={`${away?.fifa_code} score`} inputMode="numeric" value={a} onChange={(e) => setA(e.target.value)} className="w-12 min-h-tap rounded text-center bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        {isKnockout && (
          <select aria-label="Winner" value={winner} onChange={(e) => setWinner(e.target.value)} className="min-h-tap rounded text-sm bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">Winner…</option>
            <option value={String(match.home_team)}>{home?.fifa_code}</option>
            <option value={String(match.away_team)}>{away?.fifa_code}</option>
          </select>
        )}
        <button type="button" disabled={busy} onClick={() => void save()} className="ml-auto min-h-tap rounded-lg bg-primary px-4 font-display text-primary-foreground active:scale-95 disabled:opacity-60">
          {busy ? 'Saving…' : 'Save & score'}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Underdog (×2):</span>
        <select
          aria-label="Underdog"
          value={match.underdog_team ? String(match.underdog_team) : ''}
          onChange={(e) => void setDog(e.target.value ? Number(e.target.value) : null)}
          className="min-h-tap rounded text-sm bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">none</option>
          <option value={String(match.home_team)}>{home?.fifa_code}</option>
          <option value={String(match.away_team)}>{away?.fifa_code}</option>
        </select>
      </div>
      <CommentaryComposer matchId={match.id} onSaved={onSaved} />
      {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
    </li>
  )
}

function CommentaryComposer({ matchId, onSaved }: { matchId: number; onSaved: (m: string) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function post() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await adminPostCommentary(matchId, text.trim())
      setText('')
      onSaved('Commentary posted.')
    } catch (e) {
      onSaved(e instanceof Error ? e.message : 'Failed to post')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        aria-label="Live commentary"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void post()}
        placeholder="Post live commentary…"
        className="min-h-tap flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void post()}
        className="min-h-tap rounded-lg bg-primary px-3 font-display text-sm text-primary-foreground active:scale-95 disabled:opacity-50"
      >
        Post
      </button>
    </div>
  )
}

function SettleRound({
  round,
  players,
  teams,
  onSaved,
  onRefresh,
}: {
  round: string
  players: PlayerCatalog[]
  teams: Map<number, Team>
  onSaved: (m: string) => void
  onRefresh: () => void
}) {
  const [scorers, setScorers] = useState<number[]>([])
  const [complete, setComplete] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function settle() {
    setErr(null)
    setBusy(true)
    try {
      await adminSettleRound(round, scorers, complete)
      onSaved(`Round ${round} settled${complete ? ' & marked complete' : ''}.`)
      onRefresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }
  const teamLabel = (id: number | null) => (id ? teams.get(id)?.fifa_code ?? '' : '')

  return (
    <section>
      <h2 className="font-display text-lg text-primary">Settle round — {round}</h2>
      <p className="text-xs text-muted-foreground">Name the round&apos;s top scorer(s) for Top Chef, then settle Spice / Clean Plate / Top Chef.</p>
      <div className="mt-2 rounded-card bg-card text-foreground shadow-sm p-3">
        <label className="text-xs font-bold uppercase text-muted-foreground">Top scorers (Top Chef)</label>
        {players.length === 0 ? (
          <p className="text-xs text-muted-foreground italic mt-1">No squads synced — Top Chef will score 0 until players exist.</p>
        ) : (
          <select
            multiple
            value={scorers.map(String)}
            onChange={(e) => setScorers([...e.target.selectedOptions].map((o) => Number(o.value)))}
            className="mt-1 w-full rounded-lg bg-background border border-input text-foreground text-sm h-28 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {players.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name} · {teamLabel(p.team)}
              </option>
            ))}
          </select>
        )}
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
          Mark round complete (opens the tournament revision window)
        </label>
        <button type="button" disabled={busy} onClick={() => void settle()} className="mt-2 min-h-tap rounded-lg bg-primary px-4 font-display text-primary-foreground active:scale-95 disabled:opacity-60">
          {busy ? 'Settling…' : 'Settle round'}
        </button>
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      </div>
    </section>
  )
}

function TournamentResults({
  teams,
  players,
  onSaved,
}: {
  teams: Map<number, Team>
  players: PlayerCatalog[]
  onSaved: (m: string) => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const teamOpts = [...teams.values()].sort((a, b) => a.name.localeCompare(b.name))

  async function set(pickType: string, selection: string) {
    if (!selection) return
    setErr(null)
    setBusy(pickType)
    try {
      await adminSetTournamentResult(pickType, selection)
      onSaved(`Tournament ${pickType} recorded & picks settled.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg text-primary">Tournament results</h2>
      <p className="text-xs text-muted-foreground">Settle the long-shot picks. Finalist: submit once per finalist.</p>
      <div className="mt-2 rounded-card bg-card text-foreground shadow-sm p-3 space-y-3">
        {(['champion', 'finalist'] as const).map((pt) => (
          <ResultPicker
            key={pt}
            label={TOURNEY_PICK_LABELS[pt] ?? pt}
            busy={busy === pt}
            options={teamOpts.map((t) => ({ value: String(t.id), label: `${t.flag_emoji} ${t.name}` }))}
            onSet={(s) => set(pt, s)}
          />
        ))}
        {(['golden_boot', 'golden_glove', 'young_player'] as const).map((pt) => (
          <ResultPicker
            key={pt}
            label={TOURNEY_PICK_LABELS[pt] ?? pt}
            busy={busy === pt}
            options={players.map((p) => ({ value: String(p.id), label: p.name }))}
            emptyNote="No squads synced."
            onSet={(s) => set(pt, s)}
          />
        ))}
        <NumberResult label={TOURNEY_PICK_LABELS.total_goals ?? 'Total goals (±5)'} busy={busy === 'total_goals'} onSet={(s) => set('total_goals', s)} />
        {err && <p className="text-xs text-destructive">{err}</p>}
      </div>
    </section>
  )
}

function ResultPicker({
  label,
  options,
  emptyNote,
  busy,
  onSet,
}: {
  label: string
  options: { value: string; label: string }[]
  emptyNote?: string
  busy: boolean
  onSet: (selection: string) => void
}) {
  const [val, setVal] = useState('')
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-sm font-bold">{label}</span>
      {options.length === 0 ? (
        <span className="text-xs text-muted-foreground italic">{emptyNote}</span>
      ) : (
        <>
          <select value={val} onChange={(e) => setVal(e.target.value)} className="flex-1 min-h-tap rounded text-sm bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="">Choose…</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button type="button" disabled={busy || !val} onClick={() => onSet(val)} className="min-h-tap rounded-lg bg-primary px-3 font-display text-primary-foreground text-sm disabled:opacity-50">
            {busy ? '…' : 'Set'}
          </button>
        </>
      )}
    </div>
  )
}

function NumberResult({ label, busy, onSet }: { label: string; busy: boolean; onSet: (s: string) => void }) {
  const [val, setVal] = useState('')
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-sm font-bold">{label}</span>
      <input inputMode="numeric" value={val} onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ''))} placeholder="actual total" className="flex-1 min-h-tap rounded px-2 text-sm bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      <button type="button" disabled={busy || !val} onClick={() => onSet(val)} className="min-h-tap rounded-lg bg-primary px-3 font-display text-primary-foreground text-sm disabled:opacity-50">
        {busy ? '…' : 'Set'}
      </button>
    </div>
  )
}

function DecayEditor({ onSaved }: { onSaved: (m: string) => void }) {
  const [rows, setRows] = useState<DecayRow[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetchDecaySchedule().then(setRows).catch(() => setRows([]))
  }, [])

  const byType = new Map<string, Map<string | null, number>>()
  for (const r of rows) {
    if (!byType.has(r.pick_type)) byType.set(r.pick_type, new Map())
    byType.get(r.pick_type)!.set(r.set_after_round, r.points)
  }
  const types = [...byType.keys()].sort(
    (a, b) => Object.keys(TOURNEY_PICK_LABELS).indexOf(a) - Object.keys(TOURNEY_PICK_LABELS).indexOf(b),
  )

  function edit(pickType: string, bucket: string | null, points: number) {
    setRows((prev) =>
      prev.map((r) => (r.pick_type === pickType && r.set_after_round === bucket ? { ...r, points } : r)),
    )
  }
  async function saveCell(pickType: string, bucket: string | null, points: number) {
    setErr(null)
    setBusy(true)
    try {
      await adminUpdateDecay(pickType, bucket, points)
      onSaved(`Decay ${pickType}/${bucket ?? 'pre'} = ${points}.`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg text-primary">Decay table editor</h2>
      <p className="text-xs text-muted-foreground">Tune the long-shot point values (spec §4.3). Blur a cell to save.</p>
      <div className="mt-2 rounded-card bg-card text-foreground shadow-sm p-3 overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left pr-2">Pick</th>
              {DECAY_BUCKETS.map((b) => (
                <th key={b.label} className="px-1 text-center">{b.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((pt) => (
              <tr key={pt} className="border-t border-border">
                <td className="pr-2 font-bold">{TOURNEY_PICK_LABELS[pt] ?? pt}</td>
                {DECAY_BUCKETS.map((b) => {
                  const v = byType.get(pt)?.get(b.key)
                  return (
                    <td key={b.label} className="px-1 py-0.5 text-center">
                      {v === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <input
                          aria-label={`${pt} ${b.label}`}
                          inputMode="numeric"
                          disabled={busy}
                          value={v}
                          onChange={(e) => edit(pt, b.key, Number(e.target.value.replace(/[^0-9]/g, '') || 0))}
                          onBlur={(e) => void saveCell(pt, b.key, Number(e.target.value.replace(/[^0-9]/g, '') || 0))}
                          className="w-10 rounded text-center bg-background border border-input text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
      </div>
    </section>
  )
}
