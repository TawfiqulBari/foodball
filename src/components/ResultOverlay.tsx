import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { FoodBallMascot, type Mood } from './FoodBallMascot'
import type { MomentKind, ResultMoment } from '../lib/resultMoments'

interface Variant {
  mood: Mood
  headline: string
  sub: string
  accent: string // tailwind text color
  particles: string[]
}

const VARIANTS: Record<MomentKind, Variant> = {
  full_course: { mood: 'happy', headline: 'FULL COURSE!', sub: 'Exact score — chef’s special!', accent: 'text-orange', particles: ['🍔', '🍟', '🥟', '🌭', '🎉'] },
  spicy: { mood: 'spicy', headline: 'SPICY PICK!', sub: 'Underdog came good — ×2!', accent: 'text-tomato', particles: ['🌶️', '🔥', '🍔', '🥟'] },
  chefs_kiss: { mood: 'happy', headline: 'CHEF’S KISS!', sub: 'Cooked to perfection.', accent: 'text-lettuce', particles: ['😘', '🍴', '🧀', '🎉'] },
  burnt_toast: { mood: 'sad', headline: 'Burnt toast.', sub: 'Next match, chef.', accent: 'text-tomato', particles: ['🍞', '🌧️'] },
}

const DISPLAY_MS = 2500

/** Full-screen result takeover (spec §7.5). ~2.5s, skippable. Honors
 *  prefers-reduced-motion by dropping to a static card. */
export function ResultOverlay({
  moment,
  homeCode,
  awayCode,
  onDone,
}: {
  moment: ResultMoment
  homeCode: string
  awayCode: string
  onDone: () => void
}) {
  const reduce = useReducedMotion()
  const v = VARIANTS[moment.kind]

  // Auto-dismiss once per mount (per moment key). Pin onDone in a ref so a parent
  // re-render (e.g. a scan appending to the queue while this overlay is up) can't
  // reset the timer by handing us a fresh closure.
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    const t = setTimeout(() => onDoneRef.current(), DISPLAY_MS)
    return () => clearTimeout(t)
  }, [])

  return (
    <motion.button
      type="button"
      onClick={onDone}
      aria-label="Dismiss result"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-cream via-yellow/40 to-orange/25 px-6 text-center"
      initial={reduce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={reduce ? undefined : { opacity: 0 }}
    >
      {!reduce && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          {v.particles.map((p, i) => (
            <motion.span
              key={i}
              className="absolute text-3xl"
              style={{ left: `${(i * 23 + 8) % 90}%`, top: '-10%' }}
              initial={{ y: '-10%', opacity: 0, rotate: 0 }}
              animate={{ y: '110vh', opacity: [0, 1, 1, 0.6], rotate: 360 }}
              transition={{ duration: 2.2, delay: i * 0.12, ease: 'easeIn' }}
            >
              {p}
            </motion.span>
          ))}
        </div>
      )}

      <motion.div
        initial={reduce ? false : { scale: 0.5, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={reduce ? undefined : { type: 'spring', stiffness: 320, damping: 16 }}
      >
        <FoodBallMascot mood={v.mood} size={120} />
      </motion.div>

      <h2 className={`mt-4 font-display text-4xl drop-shadow-sm ${v.accent}`}>{v.headline}</h2>
      <p className="mt-1 font-body text-ink/70">{v.sub}</p>
      <p className="mt-1 font-body text-xs text-ink/50">
        {homeCode} {moment.homeScore}–{moment.awayScore} {awayCode}
      </p>

      <motion.p
        className={`mt-3 font-display text-5xl ${moment.points > 0 ? 'text-orange' : 'text-ink/40'}`}
        initial={reduce ? false : { scale: 0.6 }}
        animate={{ scale: 1 }}
        transition={reduce ? undefined : { type: 'spring', stiffness: 260, damping: 14, delay: 0.15 }}
      >
        {moment.points > 0 ? `+${moment.points}` : '+0'}
      </motion.p>

      <p className="mt-6 font-body text-xs text-ink/40">tap to continue</p>
    </motion.button>
  )
}
