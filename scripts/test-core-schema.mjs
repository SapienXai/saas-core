import { readdir, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const migrationPath = path.join(root, "supabase/migrations/20260827204359_saas_core_v2_baseline.sql")
const migration = await readFile(migrationPath, "utf8")
const persistenceMigrationPath = path.join(root, "supabase/migrations/20260909094344_reusable_billing_persistence.sql")
const persistenceMigration = await readFile(persistenceMigrationPath, "utf8")
const templatePersistenceMigration = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260909094344_reusable_billing_persistence.sql"), "utf8")
const entitlementMigrationPath = path.join(root, "supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql")
const entitlementMigration = await readFile(entitlementMigrationPath, "utf8")
const templateEntitlementMigration = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql"), "utf8")
const planCatalogMigrationPath = path.join(root, "supabase/migrations/20260914100000_reusable_plan_catalog_management.sql")
const planCatalogMigration = await readFile(planCatalogMigrationPath, "utf8")
const templatePlanCatalogMigration = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260914100000_reusable_plan_catalog_management.sql"), "utf8")
const additivePlanExpansionPath = path.join(root, "supabase/migrations/20261008190000_allow_additive_plan_entitlement_expansions.sql")
const additivePlanExpansion = await readFile(additivePlanExpansionPath, "utf8")
const templateAdditivePlanExpansion = await readFile(path.join(root, "packages/app/template/supabase/migrations/20261008190000_allow_additive_plan_entitlement_expansions.sql"), "utf8")
const invitationRenewalFixPath = path.join(root, "supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql")
const invitationRenewalFix = await readFile(invitationRenewalFixPath, "utf8")
const templateInvitationRenewalFix = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql"), "utf8")
const scheduledDowngradeCeilingPath = path.join(root, "supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql")
const scheduledDowngradeCeiling = await readFile(scheduledDowngradeCeilingPath, "utf8")
const templateScheduledDowngradeCeiling = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql"), "utf8")
const invalidScheduledDowngradeFixPath = path.join(root, "supabase/migrations/20260915090000_fix_invalid_scheduled_downgrade_fail_closed.sql")
const invalidScheduledDowngradeFix = await readFile(invalidScheduledDowngradeFixPath, "utf8")
const templateInvalidScheduledDowngradeFix = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260915090000_fix_invalid_scheduled_downgrade_fail_closed.sql"), "utf8")
const scheduledProviderPriceTrustPath = path.join(root, "supabase/migrations/20260915120000_scheduled_provider_price_trust.sql")
const scheduledProviderPriceTrust = await readFile(scheduledProviderPriceTrustPath, "utf8")
const templateScheduledProviderPriceTrust = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260915120000_scheduled_provider_price_trust.sql"), "utf8")
const domainFoundationPath = path.join(root, "supabase/migrations/20260916120000_saas_core_domain_foundation_v1.sql")
const domainFoundation = await readFile(domainFoundationPath, "utf8")
const templateDomainFoundation = await readFile(path.join(root, "packages/app/template/supabase/migrations/20260916120000_saas_core_domain_foundation_v1.sql"), "utf8")
const runtimePersistence = await readFile(path.join(root, "lib/billing/persistence.ts"), "utf8")
const directMigrationNames = async (directory) => (await readdir(directory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort()
const rootDirectMigrations = await directMigrationNames(path.join(root, "supabase/migrations"))
const templateDirectMigrations = await directMigrationNames(path.join(root, "packages/app/template/supabase/migrations"))
if (JSON.stringify(rootDirectMigrations) !== JSON.stringify(templateDirectMigrations)) throw new Error(`Root/template direct Core migration filename drift: root=${rootDirectMigrations.join(", ")} template=${templateDirectMigrations.join(", ")}`)
for (const name of rootDirectMigrations) {
  const rootSource = await readFile(path.join(root, "supabase/migrations", name), "utf8")
  const templateSource = await readFile(path.join(root, "packages/app/template/supabase/migrations", name), "utf8")
  if (rootSource !== templateSource) throw new Error(`Root and template direct Core migrations are not byte-for-byte identical: ${name}`)
}
const platformGuardMigration = await readFile(path.join(root, "supabase/migrations/20260830150000_saas_core_platform_user_guards.sql"), "utf8")
for (const contract of [
  "create or replace function public.prevent_platform_owner_lockout()",
  "create or replace function public.prevent_platform_control_lockout()",
  "platform_members_owner_lockout",
  "platform_user_controls_owner_lockout",
  "PLATFORM_OWNER_LOCKOUT",
  "revoke all on function public.prevent_platform_owner_lockout() from public, anon, authenticated",
]) if (!platformGuardMigration.includes(contract)) throw new Error(`Platform owner guard migration is missing its security contract: ${contract}`)
if (persistenceMigration !== templatePersistenceMigration) throw new Error("Root and template reusable billing migrations are not byte-for-byte identical.")
if (entitlementMigration !== templateEntitlementMigration) throw new Error("Root and template entitlement enforcement migrations are not byte-for-byte identical.")
if (planCatalogMigration !== templatePlanCatalogMigration) throw new Error("Root and template plan catalog migrations are not byte-for-byte identical.")
if (additivePlanExpansion !== templateAdditivePlanExpansion) throw new Error("Root and template additive plan expansion migrations are not byte-for-byte identical.")
if (invitationRenewalFix !== templateInvitationRenewalFix) throw new Error("Root and template invitation renewal fix migrations are not byte-for-byte identical.")
if (scheduledDowngradeCeiling !== templateScheduledDowngradeCeiling) throw new Error("Root and template scheduled downgrade ceiling migrations are not byte-for-byte identical.")
if (invalidScheduledDowngradeFix !== templateInvalidScheduledDowngradeFix) throw new Error("Root and template invalid scheduled downgrade fix migrations are not byte-for-byte identical.")
if (scheduledProviderPriceTrust !== templateScheduledProviderPriceTrust) throw new Error("Root and template scheduled provider price trust migrations are not byte-for-byte identical.")
if (domainFoundation !== templateDomainFoundation) throw new Error("Root and template domain foundation migrations are not byte-for-byte identical.")
for (const contract of [
  "create table if not exists public.public_sites",
  "alter table public.workspace_domains add column if not exists site_id uuid",
  "workspace_domains_site_workspace_id_fkey",
  "workspace_domains_normalized_hostname_key",
  "workspace_domains_one_primary_per_site_key",
  "alter table public.public_sites enable row level security",
  "revoke insert, update, delete on public.public_sites from authenticated",
  "revoke insert, update, delete on public.workspace_domains from authenticated",
  "drop policy if exists domains_manage on public.workspace_domains",
  "create or replace function public.claim_platform_subdomain(",
  "create or replace function public.resolve_domain_host(",
  "revoke all on function public.claim_platform_subdomain(uuid, uuid, text, boolean) from public, anon, authenticated",
  "grant execute on function public.resolve_domain_host(text) to service_role",
]) if (!domainFoundation.includes(contract)) throw new Error(`Domain foundation is missing its contract: ${contract}`)
if (domainFoundation.toLowerCase().includes("reserv" + "ation") || domainFoundation.toLowerCase().includes("rest" + "aurant")) throw new Error("The reusable domain foundation migration contains product-domain vocabulary.")
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
if (!entitlementMigration.includes("create or replace function public.lock_workspace_entitlement(") || !entitlementMigration.includes("pg_advisory_xact_lock") || !entitlementMigration.includes("for update")) {
  throw new Error("Entitlement enforcement migration is missing the transaction-scoped workspace quota lock.")
}
if (!entitlementMigration.includes("create or replace function public.get_core_default_plan_key()") || !entitlementMigration.includes("revoke all on function public.get_core_default_plan_key() from public, anon, authenticated") || !entitlementMigration.includes("grant execute on function public.get_core_default_plan_key() to service_role")) {
  throw new Error("The server fallback lookup is not bound to the configured private default plan.")
}
if (!entitlementMigration.includes("security definer") || !entitlementMigration.includes("set search_path = public, private") || !entitlementMigration.includes("revoke all on function public.lock_workspace_entitlement(uuid, text) from public, anon, authenticated") || !entitlementMigration.includes("grant execute on function public.lock_workspace_entitlement(uuid, text) to service_role")) {
  throw new Error("Entitlement enforcement RPC is not protected by a fixed search_path and server-only grants.")
}
if (!entitlementMigration.includes("private.assert_workspace_member_available") || !entitlementMigration.includes("USER_LIMIT_REACHED") || !entitlementMigration.includes("create or replace function public.renew_workspace_invitation(") || !entitlementMigration.includes("revoke all on function public.renew_workspace_invitation(uuid, text) from public, anon, authenticated") || !entitlementMigration.includes("grant execute on function public.renew_workspace_invitation(uuid, text) to authenticated") || !entitlementMigration.includes("revoke insert, update, delete on public.workspace_members, public.workspace_invitations from anon, authenticated")) {
  throw new Error("Core-managed membership mutations are not routed through the guarded entitlement boundary.")
}
if (!entitlementMigration.includes("subscription_row.source <> 'manual'") || !entitlementMigration.includes("provider_customer_id") || !entitlementMigration.includes("provider_subscription_id") || !entitlementMigration.includes("candidate_provider_price_id") || !entitlementMigration.includes("current_period_end_at")) {
  throw new Error("Paid entitlement projections are missing the complete provider-identity fail-closed check.")
}
if (!scheduledDowngradeCeiling.includes("create or replace function public.lock_workspace_entitlement(") || !scheduledDowngradeCeiling.includes("scheduled_plan.sort_order < selected_plan.sort_order") || !scheduledDowngradeCeiling.includes("scheduled_change_action, '') not in ('cancel', 'pause', 'resume')") || !scheduledDowngradeCeiling.includes("not scheduled_limit_valid") || !scheduledDowngradeCeiling.includes("pg_advisory_xact_lock")) {
  throw new Error("Scheduled downgrade consumption ceiling is missing the ordered, cancellation-safe entitlement lock policy.")
}
if (!invalidScheduledDowngradeFix.includes("create or replace function public.lock_workspace_entitlement(") || !invalidScheduledDowngradeFix.includes("if invalid_scheduled_downgrade then") || !invalidScheduledDowngradeFix.includes("return query select selected_plan.key, false, false, null::integer, false") || !invalidScheduledDowngradeFix.includes("revoke all on function public.lock_workspace_entitlement(uuid, text) from public, anon, authenticated") || !invalidScheduledDowngradeFix.includes("grant execute on function public.lock_workspace_entitlement(uuid, text) to service_role")) {
  throw new Error("Invalid scheduled downgrade target is not guarded by an additive fail-closed entitlement replacement.")
}
if (invalidScheduledDowngradeFix.includes("20260914185445_scheduled_downgrade_consumption_ceiling.sql")) {
  throw new Error("The invalid scheduled downgrade fix must remain an additive SQL replacement, not an in-place migration edit.")
}
if (!scheduledProviderPriceTrust.includes("pg_advisory_xact_lock") || !scheduledProviderPriceTrust.includes("scheduled_target_provider_valid") || !scheduledProviderPriceTrust.includes("candidate_provider_price_id = subscription_row.scheduled_provider_price_id") || !scheduledProviderPriceTrust.includes("interval_change")) {
  throw new Error("Scheduled provider price trust migration is missing the dual-price fail-closed policy or interval transition schema.")
}
if (scheduledDowngradeCeiling.toLowerCase().includes("rest" + "aurant") || scheduledDowngradeCeiling.toLowerCase().includes("reserv" + "ation")) {
  throw new Error("The scheduled downgrade entitlement migration contains product-domain vocabulary.")
}
if (!planCatalogMigration.includes("add column if not exists description") || !planCatalogMigration.includes("plans_description_length_check") || !planCatalogMigration.includes("create or replace function private.guard_referenced_plan_change()") || !planCatalogMigration.includes("PLAN_REFERENCED_IMMUTABLE") || !planCatalogMigration.includes("PLAN_REFERENCED_ACTIVE")) {
  throw new Error("Plan catalog lifecycle migration is missing description persistence or historical entitlement protection.")
}
if (!planCatalogMigration.includes("before update on public.plans") || !planCatalogMigration.includes("revoke all on function private.guard_referenced_plan_change() from public, anon, authenticated")) {
  throw new Error("Plan catalog lifecycle guard is not attached or restricted to server-controlled execution.")
}
for (const contract of ["private.is_plan_entitlement_expansion(", "new_features", "new_limits", "PLAN_REFERENCED_IMMUTABLE", "revoke all on function private.is_plan_entitlement_expansion(jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated"]) {
  if (!additivePlanExpansion.includes(contract)) throw new Error(`Referenced plan expansion migration is missing its monotonic grant contract: ${contract}`)
}
if (!invitationRenewalFix.includes("create or replace function public.renew_workspace_invitation(") || !invitationRenewalFix.includes("update public.workspace_invitations as invitation") || !invitationRenewalFix.includes("returning invitation.id, invitation.email, invitation.role, invitation.expires_at") || invitationRenewalFix.includes("returning id, email, role, expires_at into")) {
  throw new Error("Invitation renewal fix is missing the qualified RETURNING contract.")
}
if (!invitationRenewalFix.includes("security definer") || !invitationRenewalFix.includes("set search_path = public, private") || !invitationRenewalFix.includes("revoke all on function public.renew_workspace_invitation(uuid, text) from public, anon, authenticated") || !invitationRenewalFix.includes("grant execute on function public.renew_workspace_invitation(uuid, text) to authenticated")) {
  throw new Error("Invitation renewal fix weakened the existing security boundary.")
}
if (["rest" + "aurant", "reserv" + "ation", "seat" + "ing", "paddle"].some((term) => entitlementMigration.toLowerCase().includes(term))) {
  throw new Error("The reusable entitlement enforcement migration contains product/provider-specific vocabulary.")
}
if (!persistenceMigration.includes("UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION") || !persistenceMigration.includes("target_allow_reclaim")) {
  throw new Error("Persistence does not preserve unknown outcomes and explicit stale-lease retry policy.")
}
const persistenceProductVocabulary = ["rest" + "aurant", "reserv" + "ation", "seat" + "ing", "paddle"]
if (persistenceProductVocabulary.some((term) => persistenceMigration.toLowerCase().includes(term))) {
  throw new Error("The reusable billing persistence migration contains product/provider-specific vocabulary.")
}
console.log(`Core schema verified: ${tables.length} baseline tables plus ${persistenceTables.length} durable billing tables and the workspace-owned public-domain surface, ${rootDirectMigrations.length} mirrored migration sources, the platform-owner guard, RLS enabled, no product tables.`)
