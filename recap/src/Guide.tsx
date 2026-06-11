import React from 'react'
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

// FoodBall palette (spec §8).
const C = {
  navy: '#0C2A1A', // deep forest-green video background (green template)
  cream: '#F1FBF4',
  ink: '#0C2A1A',
  orange: '#34C77A', // green primary (headings / chips)
  yellow: '#D9F99D', // light lime
  bun: '#F2A93B',
  lettuce: '#7CC243',
  tomato: '#E2504C',
  pitch: '#2c8f41',
}
const FONT = '"Luckiest Guy", "Arial Black", system-ui, sans-serif'
const BODY = 'Nunito, system-ui, sans-serif'

function useEnter(delay = 0) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: frame - delay, fps, config: { damping: 16, stiffness: 200 } })
  return { s, scale: interpolate(s, [0, 1], [0.7, 1]), op: interpolate(s, [0, 1], [0, 1]), y: interpolate(s, [0, 1], [40, 0]) }
}

const Scene: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 90 }}>
    {children}
  </AbsoluteFill>
)

const Heading: React.FC<{ children: React.ReactNode; color?: string; delay?: number }> = ({ children, color = C.orange, delay = 4 }) => {
  const e = useEnter(delay)
  return (
    <div style={{ fontFamily: FONT, fontSize: 76, color, opacity: e.op, transform: `translateY(${e.y}px)` }}>{children}</div>
  )
}

const Line: React.FC<{ children: React.ReactNode; delay: number; size?: number; color?: string }> = ({ children, delay, size = 38, color = C.cream }) => {
  const e = useEnter(delay)
  return (
    <div style={{ fontFamily: BODY, fontWeight: 700, fontSize: size, color, opacity: e.op, transform: `translateY(${e.y}px)`, marginTop: 18 }}>
      {children}
    </div>
  )
}

const Chip: React.FC<{ children: React.ReactNode; delay: number; bg?: string; color?: string }> = ({ children, delay, bg = C.orange, color = '#fff' }) => {
  const e = useEnter(delay)
  return (
    <span style={{ display: 'inline-block', margin: 8, padding: '12px 26px', borderRadius: 999, background: bg, color, fontFamily: FONT, fontSize: 34, transform: `scale(${e.scale})`, opacity: e.op }}>
      {children}
    </span>
  )
}

/** Opening title — fully visible at frame 0 (gentle pulse only), so the video's
 *  first frame & poster clearly say "How to play FoodBall". */
const TitleCard: React.FC = () => {
  const frame = useCurrentFrame()
  const pulse = 1 + 0.03 * Math.sin(frame / 8)
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 80, background: C.navy }}>
      <div style={{ fontSize: 120, transform: `scale(${pulse})` }}>🍔⚽</div>
      <div style={{ fontFamily: FONT, fontSize: 90, color: C.orange, marginTop: 8, lineHeight: 1.05 }}>
        How to play FoodBall
      </div>
      <div style={{ fontFamily: BODY, fontWeight: 800, fontSize: 42, color: C.yellow, marginTop: 16 }}>
        Predict. Feast. Repeat.
      </div>
    </AbsoluteFill>
  )
}

export const Guide: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: C.navy }}>
      {/* S1 — welcome. Title is fully visible from frame 0 so the poster / first
          frame clearly reads "How to play FoodBall" (it only gently pulses). */}
      <Sequence durationInFrames={120}>
        <TitleCard />
      </Sequence>

      {/* S2 — predict for points */}
      <Sequence from={120} durationInFrames={210}>
        <Scene>
          <Heading>1 · Predict the match</Heading>
          <Line delay={10}>Tap who wins — home, draw or away.</Line>
          <div style={{ marginTop: 26 }}>
            <Chip delay={20} bg={C.lettuce}>Chef’s Kiss +10</Chip>
            <Chip delay={28} bg={C.bun} color={C.navy}>Underdog ×2</Chip>
          </div>
          <Line delay={40} size={30} color={C.cream}>Right call = points. Miss = Burnt Toast (no penalty).</Line>
        </Scene>
      </Sequence>

      {/* S3 — side dishes */}
      <Sequence from={330} durationInFrames={210}>
        <Scene>
          <Heading>2 · Add side dishes 🍟</Heading>
          <div style={{ marginTop: 26 }}>
            <Chip delay={12} bg={C.orange}>Exact score +25</Chip>
            <Chip delay={20} bg={C.orange}>Both teams score +5</Chip>
            <Chip delay={28} bg={C.orange}>Over / Under +5</Chip>
          </div>
          <Line delay={40} size={30}>Nail the exact score for a Full Course.</Line>
        </Scene>
      </Sequence>

      {/* S4 — round + tournament picks (decay) */}
      <Sequence from={540} durationInFrames={210}>
        <Scene>
          <Heading>3 · Round &amp; long-shot picks</Heading>
          <Line delay={10}>Top Chef, Clean Plate, Spice of the Round.</Line>
          <Line delay={22} color={C.yellow}>Champion, Golden Boot, finalists…</Line>
          <Line delay={34} size={30} color={C.bun}>⏳ Pick early — long shots are worth more, then decay.</Line>
        </Scene>
      </Sequence>

      {/* S5 — match day */}
      <Sequence from={750} durationInFrames={180}>
        <Scene>
          <div style={{ width: 520, height: 150, borderRadius: 16, background: C.pitch, border: '4px solid rgba(255,255,255,0.5)', position: 'relative', marginBottom: 30 }}>
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.5)' }} />
            <div style={{ fontSize: 54, position: 'absolute', left: 90, top: 44 }}>🙂</div>
            <div style={{ fontSize: 54, position: 'absolute', right: 90, top: 44 }}>😮</div>
          </div>
          <Heading delay={2}>4 · Match Day 🏟️</Heading>
          <Line delay={14} size={32}>Watch your pick on the pitch. Goals make the stands erupt.</Line>
        </Scene>
      </Sequence>

      {/* S6 — leaderboard + prize */}
      <Sequence from={930} durationInFrames={120}>
        <Scene>
          <Heading delay={2}>Climb the Food Chain 🍽️</Heading>
          <div style={{ fontSize: 96, marginTop: 10 }}>🥇🥈🥉</div>
          <Line delay={16} size={46} color={C.yellow}>Champion eats free 🍔</Line>
        </Scene>
      </Sequence>
    </AbsoluteFill>
  )
}
