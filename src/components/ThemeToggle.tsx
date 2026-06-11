import { useTheme } from '../lib/theme'

/** Light/dark switch for the header. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={dark}
      title={dark ? 'Light mode' : 'Dark mode'}
      className="grid h-9 w-9 place-items-center rounded-full bg-white/20 text-lg text-white transition hover:bg-white/30 active:scale-90"
    >
      {dark ? '🌙' : '☀️'}
    </button>
  )
}
