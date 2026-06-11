import { z } from 'zod'

// One leaderboard row, with its avatar pre-rendered to a data URI by render.mjs
// (so the composition never makes a network/DiceBear call per frame).
export const recapRow = z.object({
  rank: z.number(),
  display_name: z.string(),
  total: z.number(),
  rank_delta: z.number(),
  avatar: z.string(), // data:image/svg+xml URI
})
export type RecapRow = z.infer<typeof recapRow>

export const recapSchema = z.object({
  round: z.string(), // e.g. "MD2"
  roundName: z.string(), // e.g. "Group Matchday 2"
  generatedAt: z.string(),
  rows: z.array(recapRow), // ranked, full table
})
export type RecapProps = z.infer<typeof recapSchema>
