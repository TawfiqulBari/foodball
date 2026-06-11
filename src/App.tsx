import { useState } from 'react'
import { useAuth } from './auth/AuthProvider'
import { BottomNav, type Tab } from './components/BottomNav'
import { Login } from './screens/Login'
import { Onboarding } from './screens/Onboarding'
import { Matches } from './screens/Matches'
import { MatchDay } from './screens/MatchDay'
import { Leaderboard } from './screens/Leaderboard'
import { MyPicks } from './screens/MyPicks'
import { More } from './screens/More'
import { Admin } from './screens/Admin'
import { Guide } from './screens/Guide'
import { ResultMoments } from './components/ResultMoments'
import { ThemeToggle } from './components/ThemeToggle'
import { isOnboarded } from './lib/avatar'
import { COPY } from './lib/copy'

const GUIDE_SEEN_KEY = 'fb.seenGuide'
function guideSeen(): boolean {
  try {
    return localStorage.getItem(GUIDE_SEEN_KEY) === '1'
  } catch {
    return false
  }
}

export default function App() {
  const { session, profile, loading } = useAuth()
  const [seenGuide, setSeenGuide] = useState(guideSeen)
  // New players land on the guide first; returning players on Matches.
  const [tab, setTab] = useState<Tab>(seenGuide ? 'matches' : 'guide')

  const markGuideSeen = () => {
    try {
      localStorage.setItem(GUIDE_SEEN_KEY, '1')
    } catch {
      /* ignore */
    }
    setSeenGuide(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="font-display text-primary text-xl animate-pulse">Firing up the grill…</p>
      </div>
    )
  }
  if (!session) return <Login />
  // First login: force display-name + avatar setup before the app proper.
  if (profile && !isOnboarded(profile.avatar_config)) return <Onboarding />

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 bg-gradient-to-r from-orange to-bun text-white px-4 py-3 flex items-center gap-2 shadow-md">
        <img src="/branding/foodball-icon.svg" alt="" className="h-8 w-8 drop-shadow" />
        <span className="font-display text-xl tracking-wide">{COPY.appName}</span>
        <span className="ml-auto hidden font-body text-xs text-white/85 sm:block">{COPY.tagline}</span>
        <div className="ml-auto sm:ml-3">
          <ThemeToggle />
        </div>
      </header>

      <main>
        {tab === 'matches' && <Matches onRoundComplete={() => setTab('matchday')} />}
        {tab === 'matchday' && <MatchDay />}
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'mypicks' && <MyPicks />}
        {tab === 'guide' && (
          <Guide
            firstRun={!seenGuide}
            onStart={() => {
              markGuideSeen()
              setTab('matches')
            }}
          />
        )}
        {tab === 'more' && <More />}
        {tab === 'admin' && <Admin />}
      </main>

      <BottomNav active={tab} onChange={setTab} isAdmin={Boolean(profile?.is_admin)} />

      {/* Result-moment overlays — the fun layer (spec §7.5). */}
      <ResultMoments />
    </div>
  )
}
