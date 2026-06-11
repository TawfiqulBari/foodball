import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

// Fail fast, loud, and at startup if config is missing — never fall back to a
// hardcoded URL/key (NIST IA-5 / the security-hardening "no secret fallbacks"
// rule). The anon key is a PUBLIC, RLS-gated key; it is safe in the client.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error(
    'FoodBall is missing its kitchen keys: set VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_ANON_KEY (see .env.example).',
  )
}

export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // magic-link callback
    flowType: 'pkce',
  },
})
