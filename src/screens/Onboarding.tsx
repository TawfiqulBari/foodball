import { useState } from 'react'
import { z } from 'zod'
import { useAuth } from '../auth/AuthProvider'
import { updateProfile } from '../lib/api'
import { AvatarBuilder } from '../components/AvatarBuilder'
import { toAvatarConfig, type AvatarConfig } from '../lib/avatar'
import { COPY } from '../lib/copy'

const nameSchema = z.string().trim().min(1, 'Pick a name your colleagues will know.').max(40)

/** First-login gate (spec §7.1): confirm display name + build an avatar. Shown
 *  until the profile has a non-empty avatar_config. */
export function Onboarding() {
  const { session, profile, refreshProfile } = useAuth()
  const [name, setName] = useState(profile?.display_name ?? '')
  const [config, setConfig] = useState<AvatarConfig>(() => toAvatarConfig(profile?.avatar_config))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function confirm() {
    setErr(null)
    const parsed = nameSchema.safeParse(name)
    if (!parsed.success) {
      setErr(parsed.error.issues[0]?.message ?? 'Add a name.')
      return
    }
    if (!session) return
    setBusy(true)
    try {
      // A non-empty avatar_config marks the profile as onboarded.
      await updateProfile(session.user.id, {
        display_name: parsed.data,
        avatar_config: { ...config, onboarded: true } as Record<string, unknown>,
      })
      await refreshProfile()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen bg-navy text-bunlight p-6">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="font-display text-3xl text-yellow text-center">Build your chef</h1>
        <p className="mt-1 text-center font-body text-bunlight/70 text-sm">
          Pick a name and a face. {COPY.motto} 🍔
        </p>

        <label htmlFor="display" className="mt-6 block text-sm text-bunlight/80 mb-1 font-body">
          Display name
        </label>
        <input
          id="display"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Chef Tawfiq"
          maxLength={40}
          className="w-full min-h-tap rounded-lg px-4 text-navy font-body outline-none focus:ring-2 focus:ring-yellow"
          autoComplete="nickname"
        />

        <div className="mt-4">
          <AvatarBuilder name={name} config={config} onChange={setConfig} />
        </div>

        {err && <p className="mt-3 text-tomato text-sm font-body">{err}</p>}

        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className="mt-5 w-full min-h-tap rounded-lg bg-yellow font-display text-navy text-lg active:scale-95 disabled:opacity-60"
        >
          {busy ? 'Plating…' : "That's me! 🍔"}
        </button>
      </div>
    </main>
  )
}
