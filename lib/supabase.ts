import "server-only"
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"

/**
 * Strict Service Role client: requires a Supabase URL and
 * SUPABASE_SERVICE_ROLE_KEY. The public URL fallback keeps server-side
 * queries working on hosts where only the client-safe URL is configured.
 * The service-role key remains server-only and is never exposed to clients.
 */
export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) {
    throw new Error("SUPABASE_URL is not set on the server.")
  }
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("SUPABASE_URL must start with https://")
  }
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for seeding.")
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "X-Client-Info": "saas-core/seed" } },
  })
}
