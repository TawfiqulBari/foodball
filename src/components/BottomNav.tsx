import { BookOpen, ClipboardList, Goal, Menu, Settings, Trophy, Tv2, type LucideIcon } from 'lucide-react'

export type Tab = 'matches' | 'matchday' | 'leaderboard' | 'mypicks' | 'guide' | 'more' | 'admin'

const TABS: { key: Tab; label: string; Icon: LucideIcon }[] = [
  { key: 'matches', label: 'Matches', Icon: Goal },
  { key: 'matchday', label: 'Stadium', Icon: Tv2 },
  { key: 'leaderboard', label: 'Food Chain', Icon: Trophy },
  { key: 'mypicks', label: 'Picks', Icon: ClipboardList },
  { key: 'guide', label: 'Guide', Icon: BookOpen },
  { key: 'more', label: 'More', Icon: Menu },
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
  const tabs = isAdmin ? [...TABS, { key: 'admin' as Tab, label: 'Admin', Icon: Settings }] : TABS
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20 border-t border-border bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-2xl">
        {tabs.map((t) => {
          const on = active === t.key
          return (
            <li key={t.key} className="flex-1">
              <button
                type="button"
                onClick={() => onChange(t.key)}
                aria-current={on ? 'page' : undefined}
                className="group flex w-full flex-col items-center justify-center gap-1 px-0.5 py-2 font-body"
              >
                <span
                  className={`flex h-8 w-12 items-center justify-center rounded-full transition-colors ${
                    on ? 'bg-primary/15 text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  }`}
                >
                  <t.Icon
                    size={22}
                    strokeWidth={on ? 2.4 : 2}
                    className="transition-transform duration-150 group-hover:scale-125 group-active:scale-110"
                  />
                </span>
                <span
                  className={`w-full truncate text-center text-[10px] font-semibold leading-none ${
                    on ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {t.label}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
