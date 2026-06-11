import type { Config } from 'tailwindcss'

// FoodBall brand palette — spec §8. Deep navy base, teal/cyan accents,
// bun-gold + warm yellow for points/celebration, lettuce green success, tomato miss.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#0A2540',
        teal: '#1C7293',
        cyan: '#17A2C4',
        bun: '#F2A93B',
        yellow: '#FFC857',
        lettuce: '#7CC243',
        tomato: '#E2504C',
        bunlight: '#FFF4DC',
      },
      fontFamily: {
        display: ['"Luckiest Guy"', 'cursive'],
        body: ['Nunito', 'system-ui', 'sans-serif'],
      },
      borderRadius: { card: '16px' },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
  plugins: [],
} satisfies Config
