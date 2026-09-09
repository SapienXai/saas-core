import { readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const migrationPath = path.join(root, "supabase/migrations/20260827204359_saas_core_v2_baseline.sql")
const migration = await readFile(migrationPath, "utf8")
const persistenceMigrationPath = path.join(root, "supabase/migrations/20260909094344_reusable_billing_persistence.sql")
const persistenceMigration = await readFile(persistenceMigrationPath, "utf8")
const templatePersistenceMigration = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260909094344_reusable_billing_persistence.sql"), "utf8")
const runtimePersistence = await readFile(path.join(root, "lib/billing/persistence.ts"), "utf8")
if (persistenceMigration !== templatePersistenceMigration) throw new Error("Root and template reusable billing migrations are not byte-for-byte identical.")
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
if (!migration.includes("create table private.core_schema_metadata") || !migration.includes("schema_version, runtime_major") || !migration.includes("values (true, '2.0', 2)")) {
  throw new Error("The Core 2.0 baseline does not initialize private schema metadata.")
}
if (!migration.includes("create table private.core_settings") || !migration.includes("default_plan_key text references public.plans(key)")) {
  throw new Error("The Core 2.0 baseline does not define the server-controlled default plan setting.")
}
if (migration.includes("unique (created_by)") || migration.includes("unique(created_by)")) {
  throw new Error("The Core tenancy model must not impose a one-workspace-per-creator database constraint.")
}
if (!migration.includes("private.core_default_plan_key()") || !migration.includes("public.sync_core_catalog")) {
  throw new Error("Workspace bootstrap is not wired to the explicit product catalog/default-plan contract.")
}

const persistenceTables = [
  "billing_provider_accounts",
  "billing_mutation_transitions",
  "billing_transition_consumptions",
]
for (const table of persistenceTables) {
  if (!persistenceMigration.includes(`create table public.${table}`)) throw new Error(`Missing persistence table: ${table}`)
  if (!persistenceMigration.includes(`alter table public.${table} enable row level security`)) throw new Error(`RLS is not enabled for persistence table: ${table}`)
  if (!persistenceMigration.includes(`public.${table}`) || !persistenceMigration.includes("from public, anon, authenticated")) {
    throw new Error(`Persistence table is not protected from public clients: ${table}`)
  }
}
if (!persistenceMigration.includes("add column if not exists environment") || !persistenceMigration.includes("billing_webhook_events_provider_environment_event_key")) {
  throw new Error("Webhook persistence is not environment-scoped.")
}
const persistenceFunctions = [
  "upsert_billing_provider_account",
  "claim_billing_webhook_event",
  "finalize_billing_webhook_event",
  "record_billing_mutation_transition",
  "update_billing_mutation_transition",
  "consume_billing_transition",
]
const runtimeFunctions = [
  ["upsert_billing_provider_account", "upsertBillingProviderAccount"],
  ["claim_billing_webhook_event", "claimBillingWebhookEvent"],
  ["finalize_billing_webhook_event", "finalizeBillingWebhookEvent"],
  ["record_billing_mutation_transition", "recordBillingMutationTransition"],
  ["update_billing_mutation_transition", "updateBillingMutationTransition"],
  ["consume_billing_transition", "consumeBillingTransition"],
]
for (const functionName of persistenceFunctions) {
  if (!persistenceMigration.includes(`create or replace function public.${functionName}(`)) throw new Error(`Missing persistence function: ${functionName}`)
  if (!persistenceMigration.includes(`revoke all on function public.${functionName}(`)) throw new Error(`Persistence function is not revoked from public roles: ${functionName}`)
  if (!persistenceMigration.includes(`grant execute on function public.${functionName}(`)) throw new Error(`Persistence function is not granted to service_role: ${functionName}`)
}
for (const [sqlName, runtimeName] of runtimeFunctions) {
  if (!persistenceMigration.includes(`create or replace function public.${sqlName}(`)) throw new Error(`Missing SQL/RPC boundary for runtime operation: ${runtimeName}`)
  if (!runtimePersistence.includes(`export async function ${runtimeName}(`)) throw new Error(`Runtime persistence wrapper is missing: ${runtimeName}`)
}
const schemaCoordinates = [
  "workspace_id uuid not null references public.workspaces(id) on delete cascade",
  "provider text not null",
  "environment text not null check (environment in ('sandbox', 'live'))",
  "provider_account_id text not null",
  "unique (workspace_id, provider, environment)",
  "unique (provider, environment, provider_account_id)",
  "unique (provider, environment, transition_key)",
  "unique (mutation_id, kind)",
  "unique (workspace_id, user_id, transition_id)",
]
for (const coordinate of schemaCoordinates) if (!persistenceMigration.includes(coordinate)) throw new Error(`Missing billing schema coordinate: ${coordinate}`)
const retryFields = ["max_attempts integer not null", "next_attempt_at timestamptz", "lease_token uuid", "lease_until timestamptz", "last_error_code text", "last_error_message text"]
for (const field of retryFields) if (!persistenceMigration.includes(field)) throw new Error(`Missing webhook lease/retry field: ${field}`)
const transitionFields = ["attempts integer not null", "max_attempts integer not null", "next_attempt_at timestamptz", "last_attempt_at timestamptz", "provider_reference text", "outcome jsonb not null"]
for (const field of transitionFields) if (!persistenceMigration.includes(field)) throw new Error(`Missing mutation transition field: ${field}`)
if (persistenceMigration.includes("security definer") || persistenceFunctions.some((functionName) => {
  const start = persistenceMigration.indexOf(`create or replace function public.${functionName}(`)
  const end = persistenceMigration.indexOf("$$;", start)
  return start < 0 || end < 0 || !persistenceMigration.slice(start, end).includes("set search_path = public")
})) {
  throw new Error("Persistence functions must use fixed search_path without public SECURITY DEFINER exposure.")
}
if (!persistenceMigration.includes("UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION") || !persistenceMigration.includes("target_allow_reclaim")) {
  throw new Error("Persistence does not preserve unknown outcomes and explicit stale-lease retry policy.")
}
const persistenceProductVocabulary = ["rest" + "aurant", "reserv" + "ation", "seat" + "ing", "paddle"]
if (persistenceProductVocabulary.some((term) => persistenceMigration.toLowerCase().includes(term))) {
  throw new Error("The reusable billing persistence migration contains product/provider-specific vocabulary.")
}
console.log(`Core schema verified: ${tables.length} baseline tables plus ${persistenceTables.length} durable billing tables, RLS enabled, no product tables.`)
