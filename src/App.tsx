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
import { RedCards } from './screens/RedCards'
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
      <header className="sticky top-0 z-20 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-2.5 px-4 py-2.5">
          <img src="/branding/foodball-icon.svg" alt="" className="h-7 w-7 rounded-md" />
          <span className="font-display text-lg font-extrabold tracking-tight text-foreground">
            Food<span className="text-primary">Ball</span>
          </span>
          <span className="ml-auto hidden font-body text-xs text-muted-foreground sm:block">{COPY.tagline}</span>
          <div className="ml-auto sm:ml-3">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl">
        {tab === 'matches' && <Matches onRoundComplete={() => setTab('matchday')} />}
        {tab === 'matchday' && <MatchDay />}
        {tab === 'leaderboard' && <Leaderboard />}
        {tab === 'mypicks' && <MyPicks />}
        {tab === 'redcards' && <RedCards />}
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
