// The burger-ball mascot as a single reusable component (spec §8). Mood swaps
// the eyes/extras — reused later by the M4 result overlays.
export type Mood = 'happy' | 'sad' | 'spicy'

export function FoodBallMascot({ mood = 'happy', size = 64 }: { mood?: Mood; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`FoodBall mascot (${mood})`}>
      {/* bun / ball body */}
      <circle cx="50" cy="50" r="46" fill="#FFF4DC" stroke="#0A2540" strokeWidth="3" />
      {/* football pentagons (bottom half) */}
      <polygon points="50,66 62,75 57,89 43,89 38,75" fill="#0A2540" />
      <polygon points="20,60 31,66 28,80 14,79 11,66" fill="#0A2540" opacity="0.85" />
      <polygon points="80,60 89,66 86,79 72,80 69,66" fill="#0A2540" opacity="0.85" />
      {/* filling stripes (middle) */}
      <rect x="14" y="46" width="72" height="6" rx="3" fill="#E2504C" />
      <rect x="14" y="52" width="72" height="7" rx="3" fill="#8A5A2B" />
      <path d="M14 45 q9 -7 18 0 q9 -7 18 0 q9 -7 18 0 q9 -7 18 0" fill="#7CC243" />
      {/* eyes */}
      {mood === 'happy' && (
        <>
          <circle cx="38" cy="34" r="5" fill="#0A2540" />
          <circle cx="62" cy="34" r="5" fill="#0A2540" />
          <circle cx="33" cy="42" r="3" fill="#F2A93B" opacity="0.7" />
          <circle cx="67" cy="42" r="3" fill="#F2A93B" opacity="0.7" />
        </>
      )}
      {mood === 'sad' && (
        <>
          <line x1="33" y1="34" x2="43" y2="38" stroke="#0A2540" strokeWidth="3" strokeLinecap="round" />
          <line x1="67" y1="34" x2="57" y2="38" stroke="#0A2540" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {mood === 'spicy' && (
        <>
          <circle cx="38" cy="33" r="6" fill="#0A2540" />
          <circle cx="62" cy="33" r="6" fill="#0A2540" />
          <path d="M30 24 l6 6 M70 24 l-6 6" stroke="#E2504C" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
    </svg>
  )
}
