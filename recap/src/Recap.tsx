import React from 'react'
import { AbsoluteFill, Img, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import type { RecapProps, RecapRow } from './schema'

// FoodBall palette (spec §8).
const C = {
  navy: '#0A2540',
  yellow: '#FFC857',
  bun: '#F2A93B',
  lettuce: '#7CC243',
  tomato: '#E2504C',
  bunlight: '#FFF4DC',
}
const FONT = '"Luckiest Guy", "Arial Black", system-ui, sans-serif'

export const Recap: React.FC<RecapProps> = ({ round, roundName, rows }) => {
  const top3 = rows.slice(0, 3)
  const sorted = [...rows]
  const climber = sorted.sort((a, b) => b.rank_delta - a.rank_delta)[0]
  const faller = [...rows].sort((a, b) => a.rank_delta - b.rank_delta)[0]
  const climbers = rows.filter((r) => r.rank_delta > 0).length

  return (
    <AbsoluteFill style={{ backgroundColor: C.navy, fontFamily: FONT, color: C.bunlight }}>
      <Sequence durationInFrames={90}>
        <Title round={round} roundName={roundName} />
      </Sequence>
      <Sequence from={90} durationInFrames={420}>
        <Podium rows={top3} />
      </Sequence>
      <Sequence from={510} durationInFrames={240}>
        <Movers climber={climber} faller={faller} />
      </Sequence>
      <Sequence from={750} durationInFrames={300}>
        <Outro climbers={climbers} />
      </Sequence>
    </AbsoluteFill>
  )
}

function useEnter(delay = 0) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 220 } })
  return { scale: interpolate(s, [0, 1], [0.6, 1]), opacity: interpolate(s, [0, 1], [0, 1]), y: interpolate(s, [0, 1], [30, 0]) }
}

const Title: React.FC<{ round: string; roundName: string }> = ({ round, roundName }) => {
  const e = useEnter(4)
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 80 }}>
      <div style={{ transform: `scale(${e.scale})`, opacity: e.opacity }}>
        <div style={{ fontSize: 64, color: C.yellow }}>FoodBall</div>
        <div style={{ fontSize: 40, marginTop: 8 }}>The Food Chain</div>
        <div style={{ fontSize: 100, color: C.bun, marginTop: 40 }}>{round}</div>
        <div style={{ fontSize: 36, opacity: 0.8 }}>{roundName} recap</div>
      </div>
    </AbsoluteFill>
  )
}

const PLATE = ['🥇', '🥈', '🥉']
const Podium: React.FC<{ rows: RecapRow[] }> = ({ rows }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 70 }}>
    <div style={{ fontSize: 52, color: C.yellow, marginBottom: 50 }}>Top of the chain</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, width: '100%' }}>
      {rows.map((r, i) => (
        <PodiumRow key={r.rank} row={r} delay={10 + i * 18} />
      ))}
      {rows.length === 0 && <div style={{ fontSize: 36, opacity: 0.6, textAlign: 'center' }}>No chefs on the board yet.</div>}
    </div>
  </AbsoluteFill>
)

const PodiumRow: React.FC<{ row: RecapRow; delay: number }> = ({ row, delay }) => {
  const e = useEnter(delay)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 28,
        background: C.bunlight,
        color: C.navy,
        borderRadius: 28,
        padding: '24px 32px',
        transform: `translateX(${(1 - e.opacity) * -60}px)`,
        opacity: e.opacity,
      }}
    >
      <div style={{ fontSize: 64, width: 80 }}>{row.rank <= 3 ? PLATE[row.rank - 1] : row.rank}</div>
      <Img src={row.avatar} style={{ width: 96, height: 96, borderRadius: 999 }} />
      <div style={{ flex: 1, fontSize: 48, fontWeight: 900 }}>{row.display_name}</div>
      <div style={{ fontSize: 56, color: C.bun }}>{row.total}</div>
    </div>
  )
}

const Movers: React.FC<{ climber?: RecapRow; faller?: RecapRow }> = ({ climber, faller }) => {
  const e = useEnter(6)
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: 80, gap: 60 }}>
      <div style={{ opacity: e.opacity, transform: `translateY(${e.y}px)`, textAlign: 'center' }}>
        <div style={{ fontSize: 44, color: C.lettuce }}>▲ Biggest climber</div>
        <div style={{ fontSize: 64 }}>{climber ? `${climber.display_name} (+${Math.max(0, climber.rank_delta)})` : '—'}</div>
      </div>
      <div style={{ opacity: e.opacity, transform: `translateY(${e.y}px)`, textAlign: 'center' }}>
        <div style={{ fontSize: 44, color: C.tomato }}>▼ Took a tumble</div>
        <div style={{ fontSize: 64 }}>{faller ? `${faller.display_name} (${faller.rank_delta})` : '—'}</div>
      </div>
    </AbsoluteFill>
  )
}

const Outro: React.FC<{ climbers: number }> = ({ climbers }) => {
  const e = useEnter(6)
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', padding: 80 }}>
      <div style={{ opacity: e.opacity, transform: `scale(${e.scale})` }}>
        <div style={{ fontSize: 56 }}>{climbers} chef{climbers === 1 ? '' : 's'} climbed the chain</div>
        <div style={{ fontSize: 88, color: C.yellow, marginTop: 60 }}>Champion eats free</div>
        <div style={{ fontSize: 40, color: C.bun, marginTop: 16 }}>Predict. Feast. Repeat.</div>
      </div>
    </AbsoluteFill>
  )
}
