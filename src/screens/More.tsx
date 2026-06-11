import { useAuth } from '../auth/AuthProvider'
import { COPY } from '../lib/copy'

export function More() {
  const { profile, signOut } = useAuth()
  return (
    <div className="px-4 pt-3 pb-24 font-body text-bunlight">
      <h1 className="font-display text-2xl text-yellow">More</h1>

      <section className="mt-4 rounded-card bg-bunlight/95 text-navy p-4">
        <h2 className="font-display text-xl">The Menu 🍽️</h2>
        <p className="text-sm mt-1 text-navy/70">How points are cooked (M1 scope):</p>
        <ul className="mt-2 text-sm list-disc list-inside space-y-1">
          <li>Correct match outcome — <strong>10 pts</strong> ({COPY.chefsKiss})</li>
          <li>Picked the underdog and they win — outcome points <strong>×2</strong> ({COPY.spice})</li>
          <li>Wrong pick — <strong>0 pts</strong> ({COPY.burntToast})</li>
          <li>No pick submitted — <strong>0 pts</strong> ({COPY.skippedLunch}), no penalty</li>
        </ul>
        <p className="text-xs mt-2 text-navy/50">
          Exact score, BTTS, over/under, props and tournament-long picks arrive in later milestones.
        </p>
      </section>

      <section className="mt-4 rounded-card bg-navy border border-yellow/40 p-4 text-center">
        <p className="font-display text-2xl text-yellow">{COPY.motto}</p>
        <p className="text-sm text-bunlight/70 mt-1">The champion&apos;s prize is set by your office admin.</p>
      </section>

      <section className="mt-4 text-sm text-bunlight/70">
        <p>Signed in as <strong className="text-bunlight">{profile?.display_name ?? '…'}</strong></p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-2 min-h-tap rounded-lg bg-tomato px-4 font-display text-bunlight active:scale-95"
        >
          Sign out
        </button>
      </section>
    </div>
  )
}
