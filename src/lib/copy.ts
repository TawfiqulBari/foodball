// FoodBall vocabulary (spec §8). Use these everywhere — never the bland term.
// The pun is the product; do not "correct" any of it.
export const COPY = {
  appName: 'FoodBall',
  tagline: 'Predict. Feast. Repeat.',
  motto: 'Champion eats free',
  leaderboard: 'The Food Chain',
  topChef: 'Top Chef',
  cleanPlate: 'Clean Plate',
  spice: 'Spice of the Round',
  fullCourse: 'Full Course', // exact-score hit
  chefsKiss: "Chef's Kiss", // correct outcome
  burntToast: 'Burnt Toast', // wrong pick
  skippedLunch: 'Skipped Lunch', // missed pick
  leftovers: 'The Leftovers zone', // last place
  emptyMatches: 'No matches cooking today. Marinate your picks for tomorrow.',
  emptyLeaderboard: 'The kitchen is empty. Make a pick to get on the board.',
} as const

export const OUTCOME_LABEL: Record<'home' | 'draw' | 'away', string> = {
  home: 'Home',
  draw: 'Draw',
  away: 'Away',
}
