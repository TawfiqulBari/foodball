import { useState } from 'react'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { COPY } from '../lib/copy'

const credsSchema = z.object({
  email: z.string().email('That email looks undercooked.'),
  password: z.string().min(8, 'Password needs at least 8 characters.'),
})
const nameSchema = z.string().trim().min(1, 'Pick a name your colleagues will know.').max(40)

type Mode = 'signin' | 'signup'

export function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const creds = credsSchema.safeParse({ email: email.trim(), password })
    if (!creds.success) {
      setError(creds.error.issues[0]?.message ?? 'Check your details.')
      return
    }
    if (mode === 'signup') {
      const name = nameSchema.safeParse(displayName)
      if (!name.success) {
        setError(name.error.issues[0]?.message ?? 'Add a display name.')
        return
      }
    }
    setBusy(true)
    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: creds.data.email,
          password: creds.data.password,
          options: { data: { display_name: displayName.trim() } },
        })
        if (error) throw error
        // Name the chef. The profile row is auto-provisioned by a DB trigger;
        // set the chosen display name now that we have a session.
        if (data.session) {
          await supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', data.session.user.id)
        } else {
          setError('Account created. Ask your admin to enable instant access, or check your email.')
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword(creds.data)
        if (error) throw error
      }
      // On success, AuthProvider's onAuthStateChange swaps in the app.
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something burned. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-cream text-ink flex flex-col items-center justify-center p-6">
      <img src="/branding/foodball-wordmark.svg" alt="FoodBall" className="w-64 max-w-full" />
      <p className="mt-2 font-display text-orange text-lg">{COPY.tagline}</p>
      <p className="mt-1 font-body text-ink/70 text-sm">{COPY.motto} 🍔</p>

      <form onSubmit={submit} className="mt-8 w-full max-w-sm font-body space-y-3">
        {mode === 'signup' && (
          <div>
            <label htmlFor="name" className="block text-sm text-ink/80 mb-1">Display name</label>
            <input
              id="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Chef Tawfiq"
              className="w-full min-h-tap rounded-lg px-4 bg-white text-ink ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-orange"
              autoComplete="nickname"
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="block text-sm text-ink/80 mb-1">Work email</label>
          <input
            id="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="w-full min-h-tap rounded-lg px-4 bg-white text-ink ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-orange"
            required
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm text-ink/80 mb-1">Password</label>
          <input
            id="password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="at least 8 characters"
            className="w-full min-h-tap rounded-lg px-4 bg-white text-ink ring-1 ring-ink/10 outline-none focus:ring-2 focus:ring-orange"
            required
          />
        </div>

        <button
          type="submit"
          disabled={busy}
          className="w-full min-h-tap rounded-lg bg-orange font-display text-white text-lg active:scale-95 disabled:opacity-60"
        >
          {busy ? 'Cooking…' : mode === 'signup' ? "Create account — let's eat" : 'Sign in'}
        </button>
        {error && <p className="text-tomato text-sm">{error}</p>}
      </form>

      <button
        type="button"
        onClick={() => {
          setMode((m) => (m === 'signin' ? 'signup' : 'signin'))
          setError(null)
        }}
        className="mt-4 font-body text-sm text-orange underline underline-offset-2"
      >
        {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </main>
  )
}
