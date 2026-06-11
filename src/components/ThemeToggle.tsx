import { Moon, Sun } from 'lucide-react'
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
      className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground active:scale-90"
    >
      {dark ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  )
}
