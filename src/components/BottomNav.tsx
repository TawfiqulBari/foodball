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
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-card/95 backdrop-blur border-t border-border shadow-[0_-2px_14px_rgba(0,0,0,0.10)] pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {tabs.map((t) => (
          <li key={t.key} className="flex-1">
            <button
              type="button"
              onClick={() => onChange(t.key)}
              className="group w-full flex items-stretch justify-center px-0.5 py-1.5 font-body"
              aria-current={active === t.key ? 'page' : undefined}
            >
              <span
                className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 transition ${
                  active === t.key
                    ? 'bg-gradient-to-b from-orange to-tomato text-white shadow-md'
                    : 'text-muted-foreground group-hover:text-foreground'
                }`}
              >
                <span
                  className={`text-3xl leading-none transition-transform duration-150 group-hover:scale-125 group-active:scale-110 ${
                    active === t.key ? 'scale-110' : ''
                  }`}
                  aria-hidden
                >
                  {t.icon}
                </span>
                <span className="w-full truncate text-center text-[11px] font-bold leading-tight">{t.label}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
