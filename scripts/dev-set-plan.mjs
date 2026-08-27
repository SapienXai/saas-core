import { execFileSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

const [workspaceSlug, planKey] = process.argv.slice(2)
const validPlans = new Set(["free", "starter", "pro", "business"])

if (!workspaceSlug || !planKey || !validPlans.has(planKey)) {
  console.error("Usage: npm run dev:set-plan -- <workspace-slug> <free|starter|pro|business>")
  process.exit(1)
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to change a plan while NODE_ENV=production.")
  process.exit(1)
}

let status
try {
  status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { encoding: "utf8" }))
} catch {
  console.error("Could not read local Supabase status. Start the isolated project with npm run db:start first.")
  process.exit(1)
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(status.API_URL || "")) {
  console.error("Refusing to change a non-local Supabase project.")
  process.exit(1)
}

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { data: workspace, error: workspaceError } = await supabase
  .from("workspaces")
  .select("id, name, slug")
  .eq("slug", workspaceSlug)
  .single()

if (workspaceError || !workspace) {
  console.error("Workspace not found in the local database.")
  process.exit(1)
}

const now = new Date()
const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10)
const { error } = await supabase
  .from("workspace_subscriptions")
  .update({
    plan_key: planKey,
    status: "active",
    source: "manual",
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: false,
  })
  .eq("workspace_id", workspace.id)

if (error) {
  console.error("Could not update the local workspace plan:", error.message)
  process.exit(1)
}

console.log(`Local workspace ${workspace.slug} is now on ${planKey}.`)
