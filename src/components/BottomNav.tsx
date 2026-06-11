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
    <nav className="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-ink/10 shadow-[0_-2px_12px_rgba(0,0,0,0.07)] pb-[env(safe-area-inset-bottom)]">
      <ul className="flex">
        {tabs.map((t) => (
          <li key={t.key} className="flex-1">
            <button
              type="button"
              onClick={() => onChange(t.key)}
              className="w-full flex items-stretch justify-center px-0.5 py-1.5 font-body"
              aria-current={active === t.key ? 'page' : undefined}
            >
              <span
                className={`flex w-full flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1.5 transition active:scale-95 ${
                  active === t.key
                    ? 'bg-gradient-to-b from-orange to-tomato text-white shadow-md'
                    : 'text-ink/55 hover:text-ink'
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden>
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
