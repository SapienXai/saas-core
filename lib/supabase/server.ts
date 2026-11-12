import "server-only"

import { createServerClient } from "@supabase/ssr"
import { CoreDataClient, createNeonTransport, restTransport } from "@sapienx/saas-core/postgres"
import { usesNeonBackend } from "@/lib/backend"
import { getNeonAuth, neonUser } from "@/lib/neon/auth"
import { cookies, headers } from "next/headers"
import type { Database } from "@/types/supabase"

export async function createSupabaseServerClient() {
  if (usesNeonBackend()) {
    const session = await getNeonAuth().api.getSession({
      headers: await headers(), query: { disableRefresh: true },
    })
    const user = session?.user.emailVerified && !session.user.banned ? neonUser(session.user) : null
    const data = new CoreDataClient<Database["public"]>(createNeonTransport(user
      ? { role: "authenticated", id: user.id, email: user.email }
      : { role: "anon" }))
    return Object.assign(data, { auth: { getUser: async () => ({ data: { user }, error: null }) } })
  }
  const legacy = await createSupabaseAuthServerClient()
  const data = new CoreDataClient<Database["public"]>(restTransport(legacy))
  return Object.assign(data, { auth: legacy.auth })
}

/** Supabase-specific auth operations are selected only on the legacy backend. */
export async function createSupabaseAuthServerClient() {
  if (usesNeonBackend()) throw new Error("Supabase authentication is disabled.")
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Supabase server authentication is not configured.")

  const cookieStore = await cookies()
  return createServerClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "saas-core/server" } },
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Server Components cannot always mutate cookies. Middleware owns
          // refresh persistence; route handlers/actions can still set them.
        }
      },
    },
  })
}
