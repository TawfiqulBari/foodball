import { useEffect, useMemo, useState } from 'react'
import { fetchProfilesByIds, fetchRedCards } from '../lib/api'
import type { Profile, RedCard } from '../lib/database.types'
import { Avatar } from '../components/Avatar'

const MARKET_LABEL: Record<string, string> = {
  outcome: 'Outcome',
  exact_score: 'Exact score',
  btts: 'Both teams to score',
  over_under: 'Over/Under 2.5',
}
const marketLabel = (m: string) => MARKET_LABEL[m] ?? m

/** Resolve a voided pick to what it backed. For an outcome pick, map home/away to
 *  the actual team from `match_label` ("HOME v AWAY") — never the raw "home"/"away". */
function cardSelectionLabel(c: RedCard): string {
  if (c.market === 'outcome') {
    const [home, away] = c.match_label.split(' v ')
    if (c.selection === 'home') return home ?? 'Home'
    if (c.selection === 'away') return away ?? 'Away'
    return 'Draw'
  }
  if (c.market === 'btts') return c.selection === 'yes' ? 'Yes' : 'No'
  if (c.market === 'over_under') return c.selection === 'over' ? 'Over 2.5' : 'Under 2.5'
  return c.selection
}

type Group = { userId: string; pointsCut: number; cards: RedCard[] }

export function RedCards() {
  const [cards, setCards] = useState<RedCard[]>([])
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    fetchRedCards()
      .then(async (rows) => {
        setCards(rows)
        setProfiles(await fetchProfilesByIds([...new Set(rows.map((r) => r.user_id))]))
      })
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>()
    for (const c of cards) {
      const g = m.get(c.user_id) ?? { userId: c.user_id, pointsCut: 0, cards: [] }
      g.pointsCut += c.points_deducted
      g.cards.push(c)
      m.set(c.user_id, g)
    }
    return [...m.values()].sort(
      (a, b) => b.pointsCut - a.pointsCut || b.cards.length - a.cards.length,
    )
  }, [cards])

  const totalCut = groups.reduce((s, g) => s + g.pointsCut, 0)

  return (
    <div className="px-4 pt-3 pb-24 font-body text-foreground">
      <div className="flex items-center gap-2">
        <span className="inline-block h-6 w-[18px] rounded-[3px] bg-destructive shadow-sm" aria-hidden />
        <h1 className="font-display text-2xl text-destructive">Red Cards</h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Predictions set <strong>after kickoff</strong> were voided and their points cut. Picks now
        lock the moment a match starts, so this can't happen again. (Admin test picks are excluded.)
      </p>

      {err && <p className="mt-3 text-sm text-destructive">{err}</p>}

      {loading ? (
        <p className="mt-8 text-center text-muted-foreground">Checking the replay…</p>
      ) : groups.length === 0 ? (
        <p className="mt-8 text-center text-muted-foreground">
          🟩 Clean game — no red cards. Everyone picked before kickoff.
        </p>
      ) : (
        <>
          <div className="mt-3 rounded-card bg-destructive/10 border border-destructive/30 px-4 py-2 text-sm">
            <strong className="text-destructive">{groups.length}</strong> participant
            {groups.length === 1 ? '' : 's'} carded · <strong className="text-destructive">−{totalCut}</strong>{' '}
            points cut across <strong>{cards.length}</strong> voided pick{cards.length === 1 ? '' : 's'}.
          </div>

          <ul className="mt-4 space-y-3">
            {groups.map((g) => {
              const p = profiles.get(g.userId)
              const name = p?.display_name ?? 'Unknown'
              const isOpen = open === g.userId
              return (
                <li key={g.userId} className="rounded-card bg-card text-card-foreground shadow-sm border border-border">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : g.userId)}
                    className="flex w-full items-center gap-3 p-4 text-left"
                    aria-expanded={isOpen}
                  >
                    <Avatar name={name} config={p?.avatar_config} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-lg">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.cards.length} red card{g.cards.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className={`font-display text-xl ${g.pointsCut > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {g.pointsCut > 0 ? `−${g.pointsCut}` : '−0'}
                      <span className="ml-1 text-xs font-body">pts</span>
                    </span>
                    <span className="ml-1 text-muted-foreground">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {isOpen && (
                    <ul className="border-t border-border px-4 py-2 text-sm">
                      {g.cards
                        .slice()
                        .sort((a, b) => b.points_deducted - a.points_deducted)
                        .map((c) => (
                          <li key={c.id} className="flex items-center gap-2 py-1.5">
                            <span className="inline-block h-3.5 w-2.5 shrink-0 rounded-[2px] bg-destructive" aria-hidden />
                            <span className="min-w-0 flex-1">
                              <span className="font-semibold">{c.match_label}</span>{' '}
                              <span className="text-muted-foreground">
                                · {marketLabel(c.market)}: {cardSelectionLabel(c)}
                              </span>
                              {c.minutes_after_kickoff != null && (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  (+{c.minutes_after_kickoff}m after KO)
                                </span>
                              )}
                            </span>
                            <span className={`shrink-0 font-bold ${c.points_deducted > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                              {c.points_deducted > 0 ? `−${c.points_deducted}` : '−0'}
                            </span>
                          </li>
                        ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
