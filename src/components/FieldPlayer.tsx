import { Avatar } from './Avatar'
import type { Kit } from '../lib/kits'

export type PlayerState = 'idle' | 'cheer' | 'cry'

const ANIM_CLASS: Record<PlayerState, string> = {
  idle: 'fb-bob',
  cheer: 'fb-cheer',
  cry: 'fb-cry',
}

/** A stylised team jersey (sleeves + collar + pattern + squad-style code). */
function Jersey({ kit, code, size }: { kit: Kit; code: string; size: number }) {
  return (
    <svg width={size * 1.15} height={size * 0.92} viewBox="0 0 48 40" className="-mt-1 drop-shadow-md" aria-hidden>
      {/* sleeves (trim colour) */}
      <path d="M3 18 L13 5 L18 12 L10 23 Z" fill={kit.secondary} stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" />
      <path d="M45 18 L35 5 L30 12 L38 23 Z" fill={kit.secondary} stroke="rgba(0,0,0,0.25)" strokeWidth="0.7" />
      {/* body */}
      <path d="M13 6 H35 L34 14 V38 H14 V14 Z" fill={kit.primary} stroke="rgba(0,0,0,0.28)" strokeWidth="0.7" />
      {/* pattern */}
      {kit.pattern === 'stripes' &&
        [16, 20.5, 25, 29.5].map((x) => (
          <rect key={x} x={x} y="7" width="2.2" height="30" fill={kit.secondary} opacity="0.95" />
        ))}
      {kit.pattern === 'hoops' &&
        [15, 23, 31].map((y) => <rect key={y} x="14" y={y} width="20" height="3.2" fill={kit.secondary} opacity="0.95" />)}
      {kit.pattern === 'sash' && <path d="M14 13 L34 29 L34 33 L14 17 Z" fill={kit.secondary} opacity="0.95" />}
      {/* collar */}
      <path d="M20 6 H28 L25.5 10.5 H22.5 Z" fill={kit.secondary} stroke="rgba(0,0,0,0.2)" strokeWidth="0.5" />
      {/* squad code */}
      <text x="24" y="27" textAnchor="middle" fontSize="8" fontWeight="800" fill={kit.text} style={{ fontFamily: 'Nunito, sans-serif' }}>
        {code}
      </text>
    </svg>
  )
}

/** An avatar wearing a team kit, standing on the pitch. CSS-keyframe animation
 *  (compositor-cheap → smooth with a full crowd on a phone; the global
 *  prefers-reduced-motion rule turns it static). Cheers/cries on goals. */
export function FieldPlayer({
  name,
  config,
  kit,
  teamCode,
  state,
  size = 44,
}: {
  name: string
  config: Record<string, unknown> | null
  kit: Kit
  teamCode: string
  state: PlayerState
  size?: number
}) {
  const mood = state === 'cheer' ? '🎉' : state === 'cry' ? '😢' : null
  const delay = state === 'idle' ? `${(name.length % 7) * 0.18}s` : '0s'

  return (
    <div
      className={`relative flex flex-col items-center ${ANIM_CLASS[state]}`}
      style={{ width: size + 8, animationDelay: delay }}
      title={`${name} · ${teamCode}`}
    >
      {mood && (
        <span className="absolute -top-4 text-lg leading-none" aria-hidden>
          {mood}
        </span>
      )}
      <Avatar name={name} config={config} size={size} className="ring-2 ring-white shadow-md" />
      <Jersey kit={kit} code={teamCode} size={size} />
      <span className="-mt-0.5 max-w-[72px] truncate rounded bg-black/30 px-1 text-[10px] font-body font-semibold text-white leading-tight">
        {name}
      </span>
    </div>
  )
}
