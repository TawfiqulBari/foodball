/**
 * seed:demo — create 8 fake chefs on a REAL Supabase project so dev screens are
 * never empty (spec §10). Uses the service-role key via the Admin API (server
 * side only — never ship this key to the browser).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
 *
 * For the local Docker harness you do NOT need this — supabase/seed.sql already
 * seeds users, fixtures, and picks.
 */
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service-role key, server-side only).')
  process.exit(1)
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } })

const CHEFS = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi']

async function main() {
  for (const name of CHEFS) {
    const email = `${name.toLowerCase()}@foodball.test`
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: name },
    })
    if (error && !/already/i.test(error.message)) {
      console.error(`  ✗ ${name}: ${error.message}`)
      continue
    }
    const id = data?.user?.id
    if (id) {
      await supabase.from('profiles').update({ display_name: name }).eq('id', id)
      console.log(`  ✓ ${name} (${email})`)
    }
  }
  // First chef is the admin.
  await supabase.from('profiles').update({ is_admin: true }).eq('display_name', 'Alice')
  console.log('Done. Alice is the admin. Add randomized picks once fixtures are seeded.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
