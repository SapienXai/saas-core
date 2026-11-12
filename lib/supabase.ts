import "server-only"
import { CoreDataClient, createNeonTransport, restTransport } from "@sapienx/saas-core/postgres"
import { usesNeonBackend } from "@/lib/backend"
import { neonAuthAdmin } from "@/lib/neon/admin"
import { neonStorage } from "@/lib/neon/storage"
import type { Database } from "@/types/supabase"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/** Service-role data and existing operator capabilities. Authorization belongs to the calling server entry point. */
export function createServiceRoleClient() {
  if (usesNeonBackend()) {
    const data = new CoreDataClient<Database["public"]>(createNeonTransport({ role: "service_role" }))
    return Object.assign(data, { auth: { admin: neonAuthAdmin }, storage: neonStorage })
  }
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error("SUPABASE_URL is not set on the server.")
  if (!/^https?:\/\//i.test(url)) throw new Error("SUPABASE_URL must start with https://")
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for seeding.")
  const legacy = createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "saas-core/seed" } },
  })
  const data = new CoreDataClient<Database["public"]>(restTransport(legacy))
  return Object.assign(data, { auth: legacy.auth, storage: legacy.storage })
}
