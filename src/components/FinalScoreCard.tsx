import { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
  fetchAllRoundProps,
  fetchLeaderboard,
  fetchPlayers,
  fetchAllMatches,
  fetchTeams,
  fetchRoundScorecard,
  fetchRounds,
  fetchTwoPhase,
  type TwoPhaseConfig,
} from '../lib/api'
import type {
  LeaderboardRow,
  MatchRow,
  PlayerCatalog,
  RoundProp,
  RoundRow,
  RoundScoreRow,
  Team,
} from '../lib/database.types'
import { Avatar } from './Avatar'
import { COPY } from '../lib/copy'

/** Round columns in play order; 'LONG' holds the tournament long-shot payouts. */
const ROUND_ORDER = ['MD1', 'MD2', 'MD3', 'R32', 'R16', 'SF', 'F', 'LONG'] as const
const ROUND_LABEL: Record<string, string> = {
  MD1: 'MD1', MD2: 'MD2', MD3: 'MD3', R32: 'R32', R16: 'R16',
  SF: 'SF', F: 'Final', LONG: 'Long shots',
}
const PROP_LABEL: Record<string, string> = {
  top_chef: COPY.topChef, clean_plate: COPY.cleanPlate, spice: COPY.spice,
}
const CONFETTI = ['🍔', '🍟', '🌮', '🍕', '🥇', '🎉', '🧀', '🍗']

/** The end-of-tournament score card: a podium of the top three chefs, the full table
 *  as `grp/100 · ko/100 · FINAL`, and — expandable per chef — the per-round points and
 *  the round specials they picked. Everything here is public: every round has locked,
 *  so RLS already reveals all picks. */
export function FinalScoreCard() {
  const reduce = useReducedMotion()
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [scores, setScores] = useState<RoundScoreRow[]>([])
  const [props, setProps] = useState<RoundProp[]>([])
  const [players, setPlayers] = useState<PlayerCatalog[]>([])
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [teams, setTeams] = useState<Map<number, Team>>(new Map())
  const [cfg, setCfg] = useState<TwoPhaseConfig | null>(null)
  const [rounds, setRounds] = useState<RoundRow[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void Promise.all([
      fetchLeaderboard(), fetchRoundScorecard(), fetchAllRoundProps(),
      fetchPlayers(), fetchAllMatches(), fetchTeams(), fetchTwoPhase(), fetchRounds(),
    ])
      .then(([lb, sc, rp, pl, ms, tm, tp, rd]) => {
        if (!alive) return
        setRows(lb); setScores(sc); setProps(rp)
        setPlayers(pl); setMatches(ms); setTeams(tm); setCfg(tp); setRounds(rd)
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  /** Self-gating: only render once the Final is played, so any screen can drop this in. */
  const tournamentOver = rounds.some((r) => r.key === 'F' && r.completed)

  // Competitors only — the admin runs the league, they don't win the prize.
  const table = useMemo(() => rows.filter((r) => r.display_name !== 'Chef tawfiq'), [rows])
  const podium = table.slice(0, 3)

  const byUserRound = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of scores) m.set(`${s.user_id}:${s.round_key}`, s.points)
    return m
  }, [scores])

  const propsByUser = useMemo(() => {
    const m = new Map<string, RoundProp[]>()
    for (const p of props) {
      const arr = m.get(p.user_id) ?? []
      arr.push(p)
      m.set(p.user_id, arr)
    }
    return m
  }, [props])

  const playerName = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of players) m.set(String(p.id), p.name)
    return m
  }, [players])

  const matchLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const mt of matches) {
      const h = teams.get(mt.home_team)?.fifa_code ?? '?'
      const a = teams.get(mt.away_team)?.fifa_code ?? '?'
      m.set(String(mt.id), `${h} v ${a}`)
    }
    return m
  }, [matches, teams])

  const labelFor = (p: RoundProp) =>
    p.prop === 'spice' ? matchLabel.get(p.selection) ?? p.selection : playerName.get(p.selection) ?? p.selection

  if (loading) return null
  if (!tournamentOver || table.length === 0) return null

  const gw = Math.round((cfg?.groupWeight ?? 0.3) * 100)
  const kw = Math.round((cfg?.knockoutWeight ?? 0.7) * 100)
  // Podium display order: 2nd, 1st, 3rd — champion in the middle and tallest.
  const order = [podium[1], podium[0], podium[2]].filter((r): r is LeaderboardRow => Boolean(r))
  const heights = ['h-16', 'h-24', 'h-12']
  const medals = ['🥈', '🥇', '🥉']

  return (
    <section className="mb-4 overflow-hidden rounded-card border border-primary/40 bg-card text-card-foreground shadow-sm">
      {/* ── Champions' table: the avatars on the podium ───────────────────── */}
      <div className="relative bg-gradient-to-b from-primary/15 to-transparent px-4 pt-4 pb-2">
        {!reduce && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            {CONFETTI.map((c, i) => (
              <motion.span
                key={i}
                className="absolute text-lg"
                style={{ left: `${8 + i * 11}%` }}
                initial={{ y: -20, opacity: 0, rotate: 0 }}
                animate={{ y: 140, opacity: [0, 1, 1, 0], rotate: 360 }}
                transition={{ duration: 4 + (i % 3), repeat: Infinity, delay: i * 0.4, ease: 'linear' }}
              >
                {c}
              </motion.span>
            ))}
          </div>
        )}

        <h2 className="relative text-center font-display text-xl font-bold text-primary">
          🏆 World Cup 2026 — Final Table
        </h2>
        <p className="relative mt-0.5 text-center font-body text-xs text-muted-foreground">
          {COPY.motto}. Here's how every chef finished.
        </p>

        <div className="relative mt-4 flex items-end justify-center gap-2 sm:gap-4">
          {order.map((r, i) => {
            const isChamp = i === 1
            return (
              <motion.div
                key={r.user_id}
                className="flex w-1/3 max-w-[112px] flex-col items-center"
                initial={reduce ? false : { y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.15 * i, type: 'spring', stiffness: 300, damping: 24 }}
              >
                <span className="text-2xl leading-none">{medals[i]}</span>
                <div className={`mt-1 rounded-full ${isChamp ? 'ring-4 ring-bun' : 'ring-2 ring-primary/40'}`}>
                  <Avatar name={r.display_name} config={r.avatar_config} size={isChamp ? 64 : 48} />
                </div>
                <span className={`mt-1 w-full truncate text-center font-body text-xs font-bold ${isChamp ? 'text-primary' : ''}`}>
                  {r.display_name}
                </span>
                <span className="font-display text-lg leading-none">{r.total}</span>
                <div
                  className={`mt-1 flex w-full ${heights[i]} items-start justify-center rounded-t-lg ${
                    isChamp ? 'bg-primary/30' : 'bg-muted'
                  }`}
                >
                  <span className="mt-1 font-display text-sm text-muted-foreground">{r.rank}</span>
                </div>
              </motion.div>
            )
          })}
        </div>

        {podium[0] && (
          <p className="relative mt-2 text-center font-display text-sm text-foreground">
            👑 <strong className="text-primary">{podium[0].display_name}</strong> eats free.
          </p>
        )}
      </div>

      {/* ── Full table ────────────────────────────────────────────────────── */}
      <div className="border-t border-border px-2 py-2">
        <div className="flex items-center gap-2 px-2 pb-1 font-body text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="w-6">#</span>
          <span className="flex-1">Chef</span>
          <span className="w-10 text-right">grp</span>
          <span className="w-10 text-right">ko</span>
          <span className="w-12 text-right">final</span>
        </div>
        <ul>
          {table.map((r) => {
            const expanded = open === r.user_id
            const mine = propsByUser.get(r.user_id) ?? []
            return (
              <li key={r.user_id} className="border-t border-border/60">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : r.user_id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2 px-2 py-2 text-left font-body"
                >
                  <span className="w-6 text-center font-display">{r.rank}</span>
                  <Avatar name={r.display_name} config={r.avatar_config} size={24} />
                  <span className="flex-1 truncate text-sm font-semibold">{r.display_name}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground">{r.group_score}</span>
                  <span className="w-10 text-right text-xs text-muted-foreground">{r.knockout_score}</span>
                  <span className="w-12 text-right font-display text-base">{r.total}</span>
                  <span className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden>▾</span>
                </button>

                {expanded && (
                  <div className="bg-muted/40 px-3 pb-3 pt-1">
                    {/* per-round points */}
                    <p className="font-body text-[10px] uppercase tracking-wide text-muted-foreground">Points per round</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {ROUND_ORDER.map((rk) => {
                        const pts = byUserRound.get(`${r.user_id}:${rk}`) ?? 0
                        return (
                          <span
                            key={rk}
                            className={`rounded-md px-1.5 py-0.5 font-body text-xs ${
                              pts > 0 ? 'bg-lettuce/20 text-lettuce' : 'bg-background text-muted-foreground'
                            }`}
                            title={ROUND_LABEL[rk]}
                          >
                            {ROUND_LABEL[rk]} <strong>{pts}</strong>
                          </span>
                        )
                      })}
                    </div>

                    {/* the specials they chose */}
                    <p className="mt-2 font-body text-[10px] uppercase tracking-wide text-muted-foreground">
                      Round specials chosen
                    </p>
                    {mine.length === 0 ? (
                      <p className="mt-0.5 font-body text-xs italic text-muted-foreground">
                        No specials picked — {COPY.skippedLunch}.
                      </p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {ROUND_ORDER.filter((rk) => rk !== 'LONG').map((rk) => {
                          const forRound = mine.filter((p) => p.round_key === rk)
                          if (forRound.length === 0) return null
                          return (
                            <li key={rk} className="flex flex-wrap items-center gap-1 font-body text-xs">
                              <span className="w-10 shrink-0 text-muted-foreground">{ROUND_LABEL[rk]}</span>
                              {forRound.map((p) => {
                                const hit = (p.points_awarded ?? 0) > 0
                                return (
                                  <span
                                    key={p.id}
                                    className={`rounded-full px-2 py-0.5 ${
                                      hit ? 'bg-lettuce/20 text-lettuce' : 'bg-background text-muted-foreground'
                                    }`}
                                    title={PROP_LABEL[p.prop] ?? p.prop}
                                  >
                                    {PROP_LABEL[p.prop]}: {labelFor(p)}
                                    {p.points_awarded != null && (hit ? ` +${p.points_awarded}` : ' +0')}
                                  </span>
                                )
                              })}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── How the final score was calculated ────────────────────────────── */}
      <div className="border-t border-border bg-muted/30 px-4 py-3">
        <p className="font-display text-sm font-bold">How the final score was cooked</p>
        <ol className="mt-1 list-decimal space-y-1 pl-4 font-body text-xs text-muted-foreground">
          <li>
            <strong className="text-foreground">Group + R32 froze</strong> when the Round of 16 began, and were
            scaled so the leader = 100 → your <strong className="text-foreground">grp</strong> score.
          </li>
          <li>
            <strong className="text-foreground">R16 → Final started fresh</strong> from zero and was scaled the same
            way → your <strong className="text-foreground">ko</strong> score. A wrong outcome cost −5 from R16 on,
            and tournament long shots settled into this phase.
          </li>
          <li>
            <strong className="text-foreground">Final = {gw}% × grp + {kw}% × ko</strong> — so the knockout run
            decided it, with group form as a head start.
          </li>
        </ol>
      </div>
    </section>
  )
}
