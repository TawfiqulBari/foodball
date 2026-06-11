// Stylized "real" national-team kits for the pitch jerseys. We can't ship
// licensed kit art, so these are recognisable approximations (primary + trim +
// pattern) of each side's actual shirt. Unknown teams get a stable derived kit.

export type KitPattern = 'solid' | 'stripes' | 'sash' | 'hoops' | 'checker'

export interface Kit {
  primary: string
  secondary: string // sleeves / trim / pattern
  text: string // number/code colour that reads on `primary`
  pattern: KitPattern
}

// Home kits for all 48 World Cup 2026 nations — recognisable approximations of
// each side's actual home shirt (primary colour, trim/pattern colour, and the
// number colour that reads on the primary). Sorted by FIFA code.
const KITS: Record<string, Kit> = {
  ALG: { primary: '#FFFFFF', secondary: '#0A7D3B', text: '#0A7D3B', pattern: 'solid' }, // white, green trim
  ARG: { primary: '#7FB4E6', secondary: '#FFFFFF', text: '#0A2540', pattern: 'stripes' }, // sky-blue & white stripes
  AUS: { primary: '#FFCD00', secondary: '#00843D', text: '#0A3D2B', pattern: 'solid' }, // socceroos gold
  AUT: { primary: '#ED2939', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // red, white trim
  BEL: { primary: '#E30613', secondary: '#000000', text: '#FAE042', pattern: 'solid' }, // red devils
  BIH: { primary: '#1A3A78', secondary: '#FFD100', text: '#FFFFFF', pattern: 'solid' }, // royal blue, gold trim
  BRA: { primary: '#FFDF00', secondary: '#009C3B', text: '#0A3D2B', pattern: 'solid' }, // canary yellow, green trim
  CAN: { primary: '#D52B1E', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // red
  COD: { primary: '#007FFF', secondary: '#CE1126', text: '#FFFFFF', pattern: 'solid' }, // sky blue, red trim
  COL: { primary: '#FCD116', secondary: '#003893', text: '#003893', pattern: 'solid' }, // yellow, blue trim
  CPV: { primary: '#003893', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // blue sharks
  CRO: { primary: '#FF0000', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'checker' }, // red & white checkerboard
  CUW: { primary: '#00529F', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // royal blue
  CZE: { primary: '#D7141A', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // red
  ECU: { primary: '#FFD100', secondary: '#034EA2', text: '#034EA2', pattern: 'solid' }, // yellow, blue trim
  EGY: { primary: '#CE1126', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // pharaohs red
  ENG: { primary: '#FFFFFF', secondary: '#1E3A8A', text: '#1E3A8A', pattern: 'solid' }, // white, navy trim
  ESP: { primary: '#C60B1E', secondary: '#FFC400', text: '#FFC400', pattern: 'solid' }, // la roja red, gold trim
  FRA: { primary: '#1E3A8A', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // les bleus
  GER: { primary: '#F4F4F4', secondary: '#111111', text: '#111111', pattern: 'solid' }, // white, black trim
  GHA: { primary: '#F4F4F4', secondary: '#CE1126', text: '#111111', pattern: 'hoops' }, // white w/ red
  HAI: { primary: '#00209F', secondary: '#D21034', text: '#FFFFFF', pattern: 'solid' }, // blue, red trim
  IRN: { primary: '#FFFFFF', secondary: '#239F40', text: '#239F40', pattern: 'solid' }, // white, green trim
  IRQ: { primary: '#FFFFFF', secondary: '#007A3D', text: '#007A3D', pattern: 'solid' }, // lions of mesopotamia white
  CIV: { primary: '#FF8200', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // les éléphants orange
  JPN: { primary: '#101C6B', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // samurai blue
  JOR: { primary: '#FFFFFF', secondary: '#CE1126', text: '#CE1126', pattern: 'solid' }, // white, red trim
  MEX: { primary: '#006847', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // el tri green
  MAR: { primary: '#C1272D', secondary: '#006233', text: '#FFFFFF', pattern: 'solid' }, // red, green trim
  NED: { primary: '#FF6F00', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // oranje
  NZL: { primary: '#FFFFFF', secondary: '#111111', text: '#111111', pattern: 'solid' }, // all whites
  NOR: { primary: '#BA0C2F', secondary: '#00205B', text: '#FFFFFF', pattern: 'solid' }, // red, navy trim
  PAN: { primary: '#D21034', secondary: '#005293', text: '#FFFFFF', pattern: 'solid' }, // red, blue trim
  PAR: { primary: '#FFFFFF', secondary: '#D52B1E', text: '#D52B1E', pattern: 'stripes' }, // red & white stripes
  POR: { primary: '#C8102E', secondary: '#006847', text: '#FFFFFF', pattern: 'solid' }, // dark red, green trim
  QAT: { primary: '#8A1538', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // maroon
  KSA: { primary: '#FFFFFF', secondary: '#006C35', text: '#006C35', pattern: 'solid' }, // green falcons — white, green trim
  SCO: { primary: '#0A2D5C', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // navy
  SEN: { primary: '#FFFFFF', secondary: '#00853F', text: '#00853F', pattern: 'solid' }, // teranga lions white, green trim
  RSA: { primary: '#FFB81C', secondary: '#007A4D', text: '#007A4D', pattern: 'solid' }, // bafana gold, green trim
  KOR: { primary: '#C8102E', secondary: '#0A2D5C', text: '#FFFFFF', pattern: 'solid' }, // taegeuk red
  SWE: { primary: '#FECC02', secondary: '#006AA7', text: '#006AA7', pattern: 'solid' }, // yellow, blue trim
  SUI: { primary: '#D52B1E', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // red w/ white cross
  TUN: { primary: '#E70013', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // eagles of carthage red
  TUR: { primary: '#E30A17', secondary: '#FFFFFF', text: '#FFFFFF', pattern: 'solid' }, // red w/ crescent
  USA: { primary: '#FFFFFF', secondary: '#1E3A8A', text: '#1E3A8A', pattern: 'sash' }, // white w/ blue sash
  URU: { primary: '#4FA3DD', secondary: '#111111', text: '#0A2540', pattern: 'solid' }, // celeste
  UZB: { primary: '#FFFFFF', secondary: '#1EB53A', text: '#1EB53A', pattern: 'solid' }, // white, green trim
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
