export type Tab = 'matches' | 'matchday' | 'leaderboard' | 'mypicks' | 'more' | 'admin'

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'matches', label: 'Matches', icon: '⚽' },
  { key: 'matchday', label: 'Stadium', icon: '🏟️' },
  { key: 'leaderboard', label: 'Food Chain', icon: '🍽️' },
  { key: 'mypicks', label: 'Picks', icon: '📋' },
  { key: 'more', label: 'More', icon: '🍔' },
]

export function BottomNav({
  active,
  onChange,
  isAdmin,
}: {
  active: Tab
  onChange: (t: Tab) => void
  isAdmin: boolean
}) {
  const tabs = isAdmin ? [...TABS, { key: 'admin' as Tab, label: 'Admin', icon: '🛠️' }] : TABS
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-navy/95 backdrop-blur border-t border-teal/40 pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {tabs.map((t) => (
          <li key={t.key} className="flex-1">
            <button
              type="button"
              onClick={() => onChange(t.key)}
              className={`w-full min-h-tap flex flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[10px] font-body font-semibold transition-colors ${
                active === t.key ? 'text-yellow' : 'text-bunlight/60 hover:text-bunlight'
              }`}
              aria-current={active === t.key ? 'page' : undefined}
            >
              <span className="text-lg leading-none" aria-hidden>
                {t.icon}
              </span>
              <span className="w-full truncate text-center leading-tight">{t.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
