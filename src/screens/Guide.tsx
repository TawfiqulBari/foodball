import { COPY } from '../lib/copy'

const STEPS: { icon: string; title: string; body: React.ReactNode }[] = [
  {
    icon: '🎯',
    title: 'Predict the match',
    body: (
      <>
        Pick who wins — home, draw or away. Correct outcome = <strong>{COPY.chefsKiss} +10</strong>. Back the
        designated underdog and they win → <strong>×2</strong>. A wrong pick is {COPY.burntToast} (0, no penalty); not
        picking is {COPY.skippedLunch}. Picks <strong>lock at kickoff</strong>.
      </>
    ),
  },
  {
    icon: '🍟',
    title: 'Add side dishes',
    body: (
      <>
        On every match you can also call the <strong>{COPY.fullCourse}</strong> (exact score, +25), <strong>both teams
        to score</strong> (+5), and <strong>over/under 2.5 goals</strong> (+5).
      </>
    ),
  },
  {
    icon: '🍽️',
    title: 'Round specials',
    body: (
      <>
        Each round, predict <strong>{COPY.topChef}</strong> (top scorer), <strong>{COPY.cleanPlate}</strong> (clean-sheet
        keeper) and <strong>{COPY.spice}</strong> (the upset). They settle when the round finishes.
      </>
    ),
  },
  {
    icon: '🏆',
    title: 'Long shots (with decay)',
    body: (
      <>
        Set tournament-long picks — Champion, both finalists, Golden Boot, Golden Glove, Best Young Player, total goals.
        <strong> Pick early: they’re worth the most, then decay</strong> each round. You can revise them between rounds.
      </>
    ),
  },
  {
    icon: '🏟️',
    title: 'Match Day',
    body: (
      <>
        Watch every chef line up on the pitch in their team’s kit. When a goal goes in, the scoring side <strong>cheers</strong>
        {' '}and the other side <strong>cries</strong>. Switch matches with the tabs.
      </>
    ),
  },
  {
    icon: '📈',
    title: COPY.leaderboard,
    body: (
      <>
        Points land live on <strong>{COPY.leaderboard}</strong> — watch the rank arrows move, and ⭐ pin up to 3 rivals to
        keep them stuck under your row. {COPY.motto} 🍔
      </>
    ),
  },
]

/** "How to play" — shown once after onboarding (firstRun) and always reachable
 *  from the Guide tab. Embeds the animated Remotion explainer. */
export function Guide({ firstRun = false, onStart }: { firstRun?: boolean; onStart?: () => void }) {
  return (
    <div className="px-4 pt-3 pb-28">
      <h1 className="font-display text-2xl text-primary">How FoodBall works</h1>
      <p className="font-body text-sm text-muted-foreground">
        Predict the World Cup, earn points (never money), and feast. Here’s the 60-second tour.
      </p>

      {/* Animated guide — autoplays muted on load; capped width so it isn't a
          giant block on desktop, with an obvious "video" caption + poster. */}
      <div className="mx-auto mt-3 w-full max-w-lg">
        <p className="mb-1 flex flex-wrap items-center gap-x-2 font-display text-sm text-primary">
          ▶ Watch: How to play FoodBall
          <span className="font-body text-xs font-normal text-muted-foreground">· 35s, no sound</span>
        </p>
        <div className="overflow-hidden rounded-card border-2 border-primary/30 bg-black shadow-lg">
          <video
            className="aspect-video w-full"
            src="/guide.mp4"
            poster="/guide-poster.png"
            autoPlay
            muted
            loop
            playsInline
            controls
            preload="auto"
          />
        </div>
      </div>

      <ol className="mt-4 space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-card border border-border bg-card p-4 font-body text-card-foreground shadow-sm">
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/15 text-lg">{s.icon}</span>
              <span className="font-display text-lg">
                {i + 1}. {s.title}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 rounded-card border border-border bg-card p-4 font-body text-sm text-muted-foreground shadow-sm">
        <span className="font-display text-base text-foreground">Install it 📲</span>
        <p className="mt-1">
          Add FoodBall to your home screen: <strong>iPhone</strong> → Share → “Add to Home Screen”; <strong>Android</strong>
          {' '}→ ⋮ → “Install app”. Full scoring lives in <strong>The Menu</strong> under “More”.
        </p>
      </div>

      {firstRun && (
        <button
          type="button"
          onClick={onStart}
          className="mt-5 w-full min-h-tap rounded-card bg-primary px-4 font-display text-lg text-primary-foreground shadow-md active:scale-95"
        >
          Let’s play — first picks 🍔
        </button>
      )}
    </div>
  )
}
