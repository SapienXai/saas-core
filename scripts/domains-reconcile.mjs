import { Vercel } from "@vercel/sdk"
import { createClient } from "@supabase/supabase-js"

const [restaurantSlug] = process.argv.slice(2)
if (!restaurantSlug) {
  console.error("Usage: npm run domains:reconcile -- <restaurant-slug>")
  process.exit(1)
}

if (process.env.NODE_ENV === "production" && process.env.DOMAINS_ALLOW_PRODUCTION_RECONCILE !== "true") {
  console.error("Refusing domain reconciliation in production without DOMAINS_ALLOW_PRODUCTION_RECONCILE=true.")
  process.exit(1)
}

const token = process.env.VERCEL_API_TOKEN
const projectId = process.env.VERCEL_PROJECT_ID
const teamId = process.env.VERCEL_TEAM_ID || undefined
const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!token || !projectId || !supabaseUrl || !serviceRoleKey) {
  console.error("Vercel and server-only Supabase environment variables are required.")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const { data: restaurant, error: restaurantError } = await supabase
  .from("restaurants")
  .select("id, slug")
  .eq("slug", restaurantSlug)
  .single()
if (restaurantError || !restaurant) {
  console.error("Restaurant not found.")
  process.exit(1)
}

const { data: localDomain, error: domainError } = await supabase
  .from("restaurant_domains")
  .select("id, hostname, status")
  .eq("restaurant_id", restaurant.id)
  .maybeSingle()
if (domainError || !localDomain || localDomain.status === "removed") {
  console.error("Restaurant does not have a connected domain mapping.")
  process.exit(1)
}

const vercel = new Vercel({ bearerToken: token })
const requestScope = teamId ? { teamId } : {}
try {
  const [projectDomain, dns] = await Promise.all([
    vercel.projects.getProjectDomain({ idOrName: projectId, domain: localDomain.hostname, ...requestScope }),
    vercel.domains.getDomainConfig({ domain: localDomain.hostname, projectIdOrName: projectId, ...requestScope }),
  ])
  const providerVerified = projectDomain.verified === true
  const dnsConfigured = !dns.misconfigured
  const status = providerVerified && dnsConfigured ? "active" : "verifying"
  const { error } = await supabase
    .from("restaurant_domains")
    .update({
      status,
      verification_state: providerVerified ? "verified" : "pending",
      provider_verified: providerVerified,
      dns_configured: dnsConfigured,
      verified_at: providerVerified ? new Date().toISOString() : null,
      last_checked_at: new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
    })
    .eq("id", localDomain.id)
  if (error) throw new Error(error.message)
  console.log(`Reconciled ${restaurant.slug} domain ${localDomain.hostname}: ${status}.`)
} catch {
  console.error("Domain provider reconciliation failed without changing provider ownership.")
  process.exit(1)
}
