import { execFileSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

const status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], {
  encoding: "utf8",
  env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
}))
if (!/^https?:\/\/(127\.0\.0\.1|localhost):55621$/.test(status.API_URL || "")) {
  throw new Error("Refusing auth E2E: the isolated local SaaS Core Supabase project is not running on port 55621.")
}

const password = "CoreAuthE2E!2026-password"
const email = `core-auth-e2e-${Date.now()}@example.test`
const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const client = createClient(status.API_URL, status.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
let userId = ""
let workspaceId = ""

try {
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error || new Error("Auth user could not be created.")
  userId = created.data.user.id
  const session = await client.auth.signInWithPassword({ email, password })
  if (session.error) throw session.error
  const bootstrap = await client.rpc("bootstrap_initial_workspace", { target_workspace_name: "Auth E2E Workspace", target_workspace_slug: `core-auth-${Date.now()}` })
  if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Workspace bootstrap did not return a workspace.")
  workspaceId = bootstrap.data[0].workspace_id
  const workspace = await client.from("workspaces").select("id, name, slug, onboarding_completed_at").eq("id", workspaceId).single()
  const subscription = await client.from("workspace_subscriptions").select("plan_key, status").eq("workspace_id", workspaceId).single()
  const plan = subscription.data?.plan_key ? await client.from("plans").select("key, active").eq("key", subscription.data.plan_key).single() : null
  if (workspace.error || subscription.error || plan?.error || !workspace.data?.onboarding_completed_at || !subscription.data?.plan_key || plan?.data?.active !== true) throw workspace.error || subscription.error || plan?.error || new Error("Workspace bootstrap did not atomically complete Core onboarding or create a subscription from an active product plan.")
  console.log(`Auth, session, atomic onboarding, tenancy, and default plan verified for ${email}.`)
} finally {
  if (workspaceId) await service.from("workspaces").delete().eq("id", workspaceId)
  if (userId) await service.auth.admin.deleteUser(userId)
}
