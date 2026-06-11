import { Avatar } from './Avatar'
import { jerseyText } from '../lib/matchField'

export type PlayerState = 'idle' | 'cheer' | 'cry'

const ANIM_CLASS: Record<PlayerState, string> = {
  idle: 'fb-bob',
  cheer: 'fb-cheer',
  cry: 'fb-cry',
}

/** An avatar wearing a team jersey, standing on the pitch. Bobs idly forever;
 *  jumps + 🎉 when their side scores, shakes + 😢 when the other side does.
 *  Animation is pure CSS (compositor-cheap → smooth with many supporters on a
 *  phone) and the global prefers-reduced-motion rule turns it static. */
export function FieldPlayer({
  name,
  config,
  teamColor,
  teamCode,
  state,
  size = 40,
}: {
  name: string
  config: Record<string, unknown> | null
  teamColor: string
  teamCode: string
  state: PlayerState
  size?: number
}) {
  const mood = state === 'cheer' ? '🎉' : state === 'cry' ? '😢' : null
  // Stagger idle bobbing so the crowd doesn't move in lockstep.
  const delay = state === 'idle' ? `${(name.length % 7) * 0.18}s` : '0s'

  return (
    <div
      className={`relative flex flex-col items-center ${ANIM_CLASS[state]}`}
      style={{ width: size, animationDelay: delay }}
      title={`${name} · ${teamCode}`}
    >
      {mood && (
        <span className="absolute -top-3 text-sm leading-none" aria-hidden>
          {mood}
        </span>
      )}
      <Avatar name={name} config={config} size={size} className="ring-2 ring-white/70 shadow" />
      {/* jersey: a little shirt in the team colour with the code */}
      <svg width={size} height={size * 0.62} viewBox="0 0 40 25" className="-mt-1 drop-shadow" aria-hidden>
        <path
          d="M2 7 L11 2 Q20 7 29 2 L38 7 L33 13 L31 11 L31 24 L9 24 L9 11 L7 13 Z"
          fill={teamColor}
          stroke="rgba(0,0,0,0.25)"
          strokeWidth="0.8"
        />
        <text
          x="20"
          y="20"
          textAnchor="middle"
          fontSize="7"
          fontWeight="700"
          fill={jerseyText(teamCode)}
          style={{ fontFamily: 'Nunito, sans-serif' }}
        >
          {teamCode}
        </text>
      </svg>
      <span className="max-w-[64px] truncate text-[10px] font-body font-semibold text-white/90 leading-tight">
        {name}
      </span>
    </div>
  )
}
