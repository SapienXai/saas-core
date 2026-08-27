import { readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const migrationPath = path.join(root, "supabase/migrations/20260827204359_saas_core_v2_baseline.sql")
const migration = await readFile(migrationPath, "utf8")
const tables = [
  "plans", "workspaces", "workspace_members", "workspace_invitations", "workspace_subscriptions",
  "workspace_usage_periods", "billing_provider_prices", "billing_webhook_events", "billing_checkout_sessions",
  "billing_mutations", "billing_cancellation_feedback", "workspace_domains", "workspace_pwa_settings",
  "workspace_push_subscriptions", "subscription_overrides", "platform_members", "platform_user_controls",
  "platform_audit_logs", "platform_settings", "email_delivery_events", "email_delivery_attempts",
  "email_provider_webhook_events", "email_outbox_runs",
]
for (const table of tables) {
  if (!migration.includes(`create table public.${table}`)) throw new Error(`Missing Core table: ${table}`)
  if (!migration.includes(`alter table public.${table} enable row level security`)) throw new Error(`RLS is not enabled for: ${table}`)
}
if (tables.some((table) => migration.includes(`create table public.${table}`) && !migration.includes(`alter table public.${table} enable row level security`))) {
  throw new Error("A Core table does not have an RLS declaration.")
}
const productVocabulary = ["rest" + "aurant", "reserv" + "ation", "seat" + "ing"]
if (productVocabulary.some((term) => migration.includes(term))) {
  throw new Error("The clean Core migration contains product-domain vocabulary.")
}
console.log(`Core schema verified: ${tables.length} generic tables, RLS enabled on every table, no product tables.`)
