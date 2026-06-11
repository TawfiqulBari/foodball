import type { Team } from '../lib/database.types'
import type { Picker, Side } from '../lib/matchField'
import { jerseyColor } from '../lib/matchField'
import { FieldPlayer, type PlayerState } from './FieldPlayer'

const DRAW_COLOR = '#6B7280' // neutral grey kit for draw-backers

/** The animated stadium for one match: home supporters up top, away at the
 *  bottom, draw-backers at the centre circle. Portrait layout → great on phones.
 *  `celebrating` drives the cheer/cry animation across both sides. */
export function MatchPitch({
  home,
  away,
  sides,
  scoreHome,
  scoreAway,
  live,
  finished,
  celebrating,
}: {
  home?: Team
  away?: Team
  sides: Record<Side, Picker[]>
  scoreHome: number
  scoreAway: number
  live: boolean
  finished: boolean
  celebrating: Side | null
}) {
  const homeCode = home?.fifa_code ?? 'HOME'
  const awayCode = away?.fifa_code ?? 'AWAY'
  const stateFor = (side: Side): PlayerState => {
    if (!celebrating || side === 'draw') return 'idle'
    return side === celebrating ? 'cheer' : 'cry'
  }

  return (
    <div className="rounded-card overflow-hidden border border-teal/40 bg-navy">
      {/* Scoreboard */}
      <div className="flex items-center justify-center gap-4 bg-navy/80 px-3 py-2 font-display text-bunlight">
        <span className="flex items-center gap-1 text-base">
          {home?.flag_emoji} {homeCode}
        </span>
        <span className="text-2xl text-yellow tabular-nums">
          {scoreHome}<span className="px-1 text-bunlight/50">–</span>{scoreAway}
        </span>
        <span className="flex items-center gap-1 text-base">
          {awayCode} {away?.flag_emoji}
        </span>
        {live ? (
          <span className="ml-1 rounded-full bg-tomato/20 px-2 py-0.5 text-[10px] font-body font-bold text-tomato animate-pulse">
            ● LIVE
          </span>
        ) : finished ? (
          <span className="ml-1 text-[11px] font-body text-bunlight/60">FT</span>
        ) : (
          <span className="ml-1 text-[11px] font-body text-teal">warming up</span>
        )}
      </div>

      {/* Pitch */}
      <div
        className="relative px-2 py-3"
        style={{
          background:
            'repeating-linear-gradient(180deg, #1f7a34 0px, #1f7a34 36px, #1c6f30 36px, #1c6f30 72px)',
        }}
      >
        {/* markings */}
        <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-white/40" />
        <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 bg-white/40" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />

        {/* HOME zone */}
        <Zone label={`Backing ${home?.flag_emoji ?? ''} ${homeCode}`} count={sides.home.length}>
          {sides.home.map((p) => (
            <FieldPlayer
              key={p.user_id}
              name={p.display_name}
              config={p.avatar_config}
              teamColor={jerseyColor(homeCode)}
              teamCode={homeCode}
              state={stateFor('home')}
            />
          ))}
        </Zone>

        {/* DRAW (centre circle) */}
        {sides.draw.length > 0 && (
          <div className="relative my-1 flex flex-wrap items-center justify-center gap-2 py-1">
            <span className="w-full text-center text-[10px] font-body font-bold uppercase tracking-wide text-white/70">
              Calling a draw
            </span>
            {sides.draw.map((p) => (
              <FieldPlayer
                key={p.user_id}
                name={p.display_name}
                config={p.avatar_config}
                teamColor={DRAW_COLOR}
                teamCode="DRAW"
                state="idle"
                size={34}
              />
            ))}
          </div>
        )}

        {/* AWAY zone */}
        <Zone label={`Backing ${away?.flag_emoji ?? ''} ${awayCode}`} count={sides.away.length}>
          {sides.away.map((p) => (
            <FieldPlayer
              key={p.user_id}
              name={p.display_name}
              config={p.avatar_config}
              teamColor={jerseyColor(awayCode)}
              teamCode={awayCode}
              state={stateFor('away')}
            />
          ))}
        </Zone>
      </div>
    </div>
  )
}

function Zone({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="relative min-h-[110px] py-1">
      <div className="mb-1 flex items-center justify-center gap-2">
        <span className="rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-display text-white">
          {label} · {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-center text-[11px] font-body italic text-white/50">No takers yet</p>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-3">{children}</div>
      )}
    </div>
  )
}
