import React from 'react'
import { Composition } from 'remotion'
import { Recap } from './Recap'
import { recapSchema, type RecapProps } from './schema'

// 9:16 vertical, 30fps, 35s — office-WhatsApp-friendly (spec §9 M5).
const DURATION = 1050
const DEFAULT_PROPS: RecapProps = {
  round: 'MD2',
  roundName: 'Group Matchday 2',
  generatedAt: '',
  rows: [],
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id="Recap"
    component={Recap}
    durationInFrames={DURATION}
    fps={30}
    width={1080}
    height={1920}
    schema={recapSchema}
    defaultProps={DEFAULT_PROPS}
  />
)
