// Light/dark theme: a `.dark` class on <html>, persisted in localStorage, with
// the OS preference as the first-run default. initTheme() runs in main.tsx before
// React renders (no flash); useTheme() drives the header toggle.
import { useState } from 'react'

export type Theme = 'light' | 'dark'
const KEY = 'fb.theme'

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'dark' || t === 'light' ? t : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function apply(t: Theme): void {
  document.documentElement.classList.toggle('dark', t === 'dark')
}

/** Resolve + apply the initial theme. Call once, early. */
export function initTheme(): Theme {
  const t = stored() ?? systemTheme()
  apply(t)
  return t
}

export function setTheme(t: Theme): void {
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private mode — falls back to in-memory for the session */
  }
  apply(t)
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, set] = useState<Theme>(() => stored() ?? systemTheme())
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    set(next)
  }
  return { theme, toggle }
}
