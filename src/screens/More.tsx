import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { fetchDecaySchedule } from '../lib/api'
import type { DecayRow } from '../lib/database.types'
import {
  DECAY_BUCKETS,
  MARKET_POINTS,
  PROP_POINTS,
  TOURNEY_PICK_LABELS,
  UPSET_MULTIPLIER,
} from '../lib/scoring'
import { COPY } from '../lib/copy'

export function More() {
  const { profile, signOut } = useAuth()
  const [decay, setDecay] = useState<DecayRow[]>([])

  useEffect(() => {
    fetchDecaySchedule()
      .then(setDecay)
      .catch(() => setDecay([]))
  }, [])

  // Group decay rows by pick_type for the grid.
  const decayByType = new Map<string, Map<string | null, number>>()
  for (const r of decay) {
    if (!decayByType.has(r.pick_type)) decayByType.set(r.pick_type, new Map())
    decayByType.get(r.pick_type)!.set(r.set_after_round, r.points)
  }
  const pickTypes = [...decayByType.keys()].sort(
    (a, b) =>
      Object.keys(TOURNEY_PICK_LABELS).indexOf(a) - Object.keys(TOURNEY_PICK_LABELS).indexOf(b),
  )

  return (
    <div className="px-4 pt-3 pb-24 font-body text-ink">
      <h1 className="font-display text-2xl text-orange">More</h1>

      {/* The Menu — auto-generated from the scoring tables (spec §7.7) */}
      <section className="mt-4 rounded-card bg-white text-ink shadow-sm p-4">
        <h2 className="font-display text-xl">The Menu 🍽️</h2>
        <p className="text-sm mt-1 text-ink/70">How points are cooked — straight from the scoring tables.</p>

        <h3 className="mt-3 font-display text-lg">Per match</h3>
        <ul className="mt-1 text-sm list-disc list-inside space-y-1">
          <li>Correct outcome — <strong>{MARKET_POINTS.outcome} pts</strong> ({COPY.chefsKiss})</li>
          <li>Exact final score — <strong>+{MARKET_POINTS.exact_score} pts</strong> bonus ({COPY.fullCourse})</li>
          <li>Both teams to score — <strong>{MARKET_POINTS.btts} pts</strong></li>
          <li>Total goals over/under 2.5 — <strong>{MARKET_POINTS.over_under} pts</strong></li>
          <li>Picked the underdog and they win — outcome <strong>×{UPSET_MULTIPLIER}</strong> ({COPY.spice})</li>
          <li>Wrong pick — <strong>0 pts</strong> ({COPY.burntToast}); no pick — {COPY.skippedLunch}, no penalty</li>
        </ul>

        <h3 className="mt-3 font-display text-lg">Per round</h3>
        <ul className="mt-1 text-sm list-disc list-inside space-y-1">
          <li>{COPY.spice} (upset of the round) — <strong>{PROP_POINTS.spice} pts</strong></li>
          <li>{COPY.topChef} (round top scorer) — <strong>{PROP_POINTS.top_chef} pts</strong></li>
          <li>{COPY.cleanPlate} (clean-sheet keeper) — <strong>{PROP_POINTS.clean_plate} pts</strong></li>
        </ul>

        <h3 className="mt-3 font-display text-lg">Tournament long shots (decay)</h3>
        <p className="text-xs text-ink/60">The later you set a pick, the less it pays.</p>
        {decay.length === 0 ? (
          <p className="mt-1 text-sm text-ink/50 italic">Loading the decay table…</p>
        ) : (
          <div className="mt-1 overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="text-ink/60">
                  <th className="text-left py-1 pr-2">Pick</th>
                  {DECAY_BUCKETS.map((b) => (
                    <th key={b.label} className="px-1 py-1 text-center">{b.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pickTypes.map((pt) => (
                  <tr key={pt} className="border-t border-ink/10">
                    <td className="py-1 pr-2 font-bold">{TOURNEY_PICK_LABELS[pt] ?? pt}</td>
                    {DECAY_BUCKETS.map((b) => {
                      const v = decayByType.get(pt)?.get(b.key)
                      return (
                        <td key={b.label} className="px-1 py-1 text-center">
                          {v ?? <span className="text-ink/30">—</span>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Prize */}
      <section className="mt-4 rounded-card bg-gradient-to-r from-orange to-bun text-white p-4 text-center">
        <p className="font-display text-2xl text-white">{COPY.motto}</p>
        <p className="text-sm text-white/80 mt-1">The champion&apos;s prize is set by your office admin.</p>
      </section>

      {/* Install as app */}
      <section className="mt-4 rounded-card bg-white text-ink shadow-sm p-4">
        <h2 className="font-display text-lg">Install FoodBall 📲</h2>
        <p className="text-sm mt-1 text-ink/70">Add it to your home screen — it runs full-screen, like a real app.</p>
        <ul className="mt-2 text-sm list-disc list-inside space-y-1">
          <li><strong>iPhone (Safari):</strong> Share → “Add to Home Screen”.</li>
          <li><strong>Android (Chrome):</strong> ⋮ menu → “Install app” / “Add to Home screen”.</li>
        </ul>
      </section>

      {/* Account */}
      <section className="mt-4 text-sm text-ink/70">
        <p>Signed in as <strong className="text-ink">{profile?.display_name ?? '…'}</strong></p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-2 min-h-tap rounded-lg bg-tomato px-4 font-display text-white active:scale-95"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}
