// Stylized "real" national-team kits for the pitch jerseys. We can't ship
// licensed kit art, so these are recognisable approximations (primary + trim +
// pattern) of each side's actual shirt. Unknown teams get a stable derived kit.

export type KitPattern = 'solid' | 'stripes' | 'sash' | 'hoops'

export interface Kit {
  primary: string
  secondary: string // sleeves / trim / pattern
  text: string // number/code colour that reads on `primary`
  pattern: KitPattern
}

const KITS: Record<string, Kit> = {
  ARG: { primary: '#7FB4E6', secondary: '#FFFFFF', text: '#0A2540', pattern: 'stripes' }, // sky-blue & white stripes
  BRA: { primary: '#FFDF00', secondary: '#009C3B', text: '#0A3D2B', pattern: 'solid' }, // canary yellow, green trim
  FRA: { primary: '#1E3A8A', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // les bleus
  GER: { primary: '#F4F4F4', secondary: '#111111', text: '#111111', pattern: 'solid' }, // white, black trim
  USA: { primary: '#FFFFFF', secondary: '#1E3A8A', text: '#1E3A8A', pattern: 'sash' }, // white w/ blue sash
  MEX: { primary: '#006847', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // el tri green
  CAN: { primary: '#D52B1E', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // red
  MAR: { primary: '#C1272D', secondary: '#006233', text: '#FFFFFF', pattern: 'solid' }, // red, green trim
  JPN: { primary: '#101C6B', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // samurai blue
  GHA: { primary: '#F4F4F4', secondary: '#CE1126', text: '#111111', pattern: 'hoops' }, // white w/ red
}

const DRAW_KIT: Kit = { primary: '#8A8F98', secondary: '#E5E7EB', text: '#1F2937', pattern: 'solid' }

export function kitFor(code: string | null | undefined): Kit {
  if (code && KITS[code]) return KITS[code]!
  // Stable derived kit for unseeded teams.
  const c = code ?? '???'
  let h = 0
  for (let i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360
  const primary = `hsl(${h}, 62%, 46%)`
  return { primary, secondary: '#FFFFFF', text: h >= 50 && h <= 195 ? '#0A2540' : '#FFFFFF', pattern: 'solid' }
}

export const drawKit = DRAW_KIT
