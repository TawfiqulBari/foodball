import { useEffect, useState } from 'react'
import type { Team } from '../lib/database.types'
import type { Picker, Side } from '../lib/matchField'
import { kitFor, drawKit } from '../lib/kits'
import { FieldPlayer, type PlayerState } from './FieldPlayer'

/** Approximate live match clock from kickoff (we have no minute-by-minute feed):
 *  the running match minute, clamped to 90+'. Ticks every 10s so it stays current. */
function LiveMinute({ kickoff }: { kickoff: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])
  const mins = Math.floor((now - new Date(kickoff).getTime()) / 60_000)
  if (Number.isNaN(mins)) return null
  const label = mins >= 90 ? "90+'" : `${Math.max(1, mins)}'`
  return (
    <span className="ml-1 rounded-md bg-black/30 px-1.5 py-0.5 text-[11px] font-display tabular-nums text-white" aria-label="match clock">
      {label}
    </span>
  )
}

/** A goal frame with net (CSS/SVG). `flip` mirrors it for the far end. */
function Goal({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 100 26"
      className="mx-auto block h-7 w-3/5 max-w-[260px]"
      preserveAspectRatio="none"
      style={flip ? { transform: 'scaleY(-1)' } : undefined}
      aria-hidden
    >
      {/* net mesh */}
      {[30, 38, 46, 54, 62, 70].map((x) => (
        <line key={x} x1={x} y1="6" x2={x} y2="24" stroke="#ffffff" strokeOpacity="0.25" strokeWidth="0.6" />
      ))}
      {[12, 18].map((y) => (
        <line key={y} x1="26" y1={y} x2="74" y2={y} stroke="#ffffff" strokeOpacity="0.25" strokeWidth="0.6" />
      ))}
      {/* frame */}
      <rect x="24" y="4" width="52" height="3" rx="1" fill="#fff" />
      <rect x="24" y="4" width="3" height="21" rx="1" fill="#fff" />
      <rect x="73" y="4" width="3" height="21" rx="1" fill="#fff" />
    </svg>
  )
}

/** The animated stadium for one match (spec): a full-height vertical pitch with
 *  goals top & bottom, home supporters defending the top, away the bottom, and
 *  draw-backers at the centre circle. `celebrating` drives cheer/cry. */
export function MatchPitch({
  home,
  away,
  sides,
  scoreHome,
  scoreAway,
  live,
  finished,
  celebrating,
  kickoff,
}: {
  home?: Team
  away?: Team
  sides: Record<Side, Picker[]>
  scoreHome: number
  scoreAway: number
  live: boolean
  finished: boolean
  celebrating: Side | null
  kickoff?: string | null
}) {
  const homeCode = home?.fifa_code ?? 'HOME'
  const awayCode = away?.fifa_code ?? 'AWAY'
  const homeKit = kitFor(homeCode)
  const awayKit = kitFor(awayCode)
  const stateFor = (side: Side): PlayerState => {
    if (!celebrating || side === 'draw') return 'idle'
    return side === celebrating ? 'cheer' : 'cry'
  }

  return (
    <div className="rounded-card overflow-hidden shadow-lg border border-border bg-card">
      {/* Scoreboard */}
      <div className="flex items-center justify-center gap-3 bg-card px-3 py-2 font-display text-card-foreground">
        <span className="flex items-center gap-1 text-lg">
          {home?.flag_emoji} {homeCode}
        </span>
        <span className="rounded-lg bg-primary px-3 py-0.5 text-2xl text-primary-foreground tabular-nums">
          {scoreHome}<span className="px-1 opacity-60">–</span>{scoreAway}
        </span>
        <span className="flex items-center gap-1 text-lg">
          {awayCode} {away?.flag_emoji}
        </span>
        {live ? (
          <>
            <span className="ml-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-body font-bold text-destructive-foreground animate-pulse">
              ● LIVE
            </span>
            {kickoff && <LiveMinute kickoff={kickoff} />}
          </>
        ) : finished ? (
          <span className="ml-1 text-[11px] font-body text-muted-foreground">FT</span>
        ) : (
          <span className="ml-1 text-[11px] font-body text-primary">warming up</span>
        )}
      </div>

      {/* Pitch — fills the screen vertically; mowing stripes + goals give depth */}
      <div
        className="relative flex min-h-[62vh] flex-col md:min-h-[70vh]"
        style={{
          background:
            'repeating-linear-gradient(180deg,#33a14a 0,#33a14a 7%,#2c8f41 7%,#2c8f41 14%)',
        }}
      >
        {/* perimeter + halfway markings */}
        <div className="pointer-events-none absolute inset-2 rounded-md border-2 border-white/45" />
        <div className="pointer-events-none absolute left-2 right-2 top-1/2 h-0.5 -translate-y-1/2 bg-white/45" />
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/45" />
        {/* soft depth vignette */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(120% 60% at 50% 50%, transparent 55%, rgba(0,0,0,0.18) 100%)' }}
        />

        <Goal />
        <Zone label={`${home?.flag_emoji ?? ''} ${homeCode}`} count={sides.home.length}>
          {sides.home.map((p) => (
            <FieldPlayer key={p.user_id} name={p.display_name} config={p.avatar_config} kit={homeKit} teamCode={homeCode} state={stateFor('home')} />
          ))}
        </Zone>

        <div className="relative z-10 flex flex-wrap items-center justify-center gap-2 py-1">
          {sides.draw.length > 0 && (
            <>
              <span className="w-full text-center text-[10px] font-body font-bold uppercase tracking-wide text-white/80 drop-shadow">
                Calling a draw
              </span>
              {sides.draw.map((p) => (
                <FieldPlayer key={p.user_id} name={p.display_name} config={p.avatar_config} kit={drawKit} teamCode="DRAW" state="idle" size={38} />
              ))}
            </>
          )}
        </div>

        <Zone label={`${away?.flag_emoji ?? ''} ${awayCode}`} count={sides.away.length}>
          {sides.away.map((p) => (
            <FieldPlayer key={p.user_id} name={p.display_name} config={p.avatar_config} kit={awayKit} teamCode={awayCode} state={stateFor('away')} />
          ))}
        </Zone>
        <Goal flip />
      </div>
    </div>
  )
}

function Zone({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="relative z-10 flex flex-1 flex-col justify-center py-2">
      <div className="mb-1 flex items-center justify-center">
        <span className="rounded-full bg-black/35 px-3 py-0.5 text-xs font-display text-white shadow">
          {label} · {count}
        </span>
      </div>
      {count === 0 ? (
        <p className="text-center text-[11px] font-body italic text-white/60">No takers yet</p>
      ) : (
        <div className="flex flex-wrap items-start justify-center gap-x-2 gap-y-2 px-1">{children}</div>
      )}
    </div>
  )
}
