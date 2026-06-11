import { useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { BottomNav, type Tab } from './components/BottomNav'
import { Login } from './screens/Login'
import { Onboarding } from './screens/Onboarding'
import { Matches } from './screens/Matches'
import { Leaderboard } from './screens/Leaderboard'
import { MyPicks } from './screens/MyPicks'
import { More } from './screens/More'
import { Admin } from './screens/Admin'
import { isOnboarded } from './lib/avatar'
import { COPY } from './lib/copy'

export default function App() {
  const { session, profile, loading } = useAuth()
  const [tab, setTab] = useState<Tab>('matches')

  if (loading) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <p className="font-display text-yellow text-xl animate-pulse">Firing up the grill…</p>
      </div>
    )
  }
  if (!session) return <Login />
  // First login: force display-name + avatar setup before the app proper.
  if (profile && !isOnboarded(profile.avatar_config)) return <Onboarding />

  return (
    <div className="min-h-screen bg-navy text-bunlight">
      <header className="sticky top-0 z-10 bg-navy/95 backdrop-blur px-4 py-3 flex items-center gap-2 border-b border-teal/30">
        <img src="/branding/foodball-icon.svg" alt="" className="h-8 w-8" />
        <span className="font-display text-xl text-yellow">{COPY.appName}</span>
        <span className="ml-auto font-body text-xs text-bunlight/50">{COPY.tagline}</span>
      </header>

      <main>
        {tab === 'matches' && <Matches />}
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'mypicks' && <MyPicks />}
        {tab === 'more' && <More />}
        {tab === 'admin' && <Admin />}
      </main>

      <BottomNav active={tab} onChange={setTab} isAdmin={Boolean(profile?.is_admin)} />
    </div>
  )
}
