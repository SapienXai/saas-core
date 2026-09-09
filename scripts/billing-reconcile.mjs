import { createClient } from "@supabase/supabase-js"
import { Environment, Paddle } from "@paddle/paddle-node-sdk"

const argumentsList = process.argv.slice(2)
const dryRun = argumentsList.includes("--dry-run") || process.env.BILLING_RECONCILE_DRY_RUN === "true"
const workspaceSlug = argumentsList.find((value) => !value.startsWith("--"))
if (!workspaceSlug) {
  console.error("Usage: npm run billing:reconcile -- <workspace-slug>")
  process.exit(1)
}

const environment = process.env.PADDLE_ENVIRONMENT
if (!environment || !["sandbox", "live"].includes(environment)) {
  console.error("PADDLE_ENVIRONMENT must be sandbox or live.")
  process.exit(1)
}
if (process.env.NODE_ENV === "production" && process.env.BILLING_ALLOW_LIVE_RECONCILE !== "true") {
  console.error("Refusing reconciliation in production without BILLING_ALLOW_LIVE_RECONCILE=true.")
  process.exit(1)
}
if (environment === "live" && process.env.BILLING_ALLOW_LIVE_RECONCILE !== "true") {
  console.error("Refusing live reconciliation without BILLING_ALLOW_LIVE_RECONCILE=true.")
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Server-only Supabase environment variables are required.")
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const { data: workspace, error: workspaceError } = await supabase
  .from("workspaces")
  .select("id, slug")
  .eq("slug", workspaceSlug)
  .single()
if (workspaceError || !workspace) {
  console.error("Workspace not found.")
  process.exit(1)
}

const { data: localState, error: stateError } = await supabase
  .from("workspace_subscriptions")
  .select("workspace_id, provider, provider_environment, provider_subscription_id, provider_price_id, billing_interval, billing_currency, current_period_start_at, current_period_end_at, last_provider_event_at, last_provider_event_id, payment_failure_started_at, payment_grace_ends_at")
  .eq("workspace_id", workspace.id)
  .single()
if (stateError || !localState?.provider_subscription_id || localState.provider !== "paddle") {
  console.error("Workspace does not have a Paddle subscription to reconcile.")
  process.exit(1)
}
if (localState.provider_environment !== environment) {
  console.error("Workspace subscription environment does not match PADDLE_ENVIRONMENT.")
  process.exit(1)
}

if (dryRun) {
  console.log(JSON.stringify({ status: "PASS", dryRun: true, workspace: workspace.slug, environment, subscriptionId: localState.provider_subscription_id }))
  process.exit(0)
}

const apiKey = process.env.PADDLE_API_KEY
if (!apiKey) {
  console.error("PADDLE_API_KEY is required for reconciliation.")
  process.exit(1)
}

const paddle = new Paddle(apiKey, { environment: environment === "sandbox" ? Environment.sandbox : Environment.production })
const subscription = await paddle.subscriptions.get(localState.provider_subscription_id)
const items = subscription.items || []
if (items.length !== 1 || items[0]?.quantity !== 1 || !items[0]?.price?.id) {
  console.error("The current Paddle subscription has an unexpected item shape. No local state was changed.")
  process.exit(1)
}
const item = items[0]
const providerPriceId = item?.price?.id || null
const { data: mapping, error: mappingError } = await supabase
  .from("billing_provider_prices")
  .select("plan_key, billing_interval, currency, provider_product_id")
  .eq("provider", "paddle")
  .eq("environment", environment)
  .eq("provider_price_id", providerPriceId)
  .maybeSingle()
if (mappingError || !mapping) {
  console.error("The current Paddle price is not registered for this environment. No local state was changed.")
  process.exit(1)
}
const providerProductId = item.price?.productId || item.price?.product_id || null
if (providerProductId && providerProductId !== mapping.provider_product_id) {
  console.error("The current Paddle product does not match its registered price. No local state was changed.")
  process.exit(1)
}

const status = subscription.status
if (!["active", "trialing", "past_due", "paused", "canceled"].includes(status)) {
  console.error("The current Paddle subscription has an unsupported status. No local state was changed.")
  process.exit(1)
}
const configuredDefault = await supabase.rpc("core_default_plan_key")
const configuredDefaultKey = Array.isArray(configuredDefault.data) ? configuredDefault.data[0]?.core_default_plan_key : configuredDefault.data?.core_default_plan_key || configuredDefault.data
const fallbackPlan = configuredDefaultKey
  ? await supabase.from("plans").select("key").eq("key", configuredDefaultKey).eq("active", true).maybeSingle()
  : await supabase.from("plans").select("key").eq("active", true).order("sort_order", { ascending: true }).order("key", { ascending: true }).limit(1).maybeSingle()
if (fallbackPlan.error || !fallbackPlan.data) {
  console.error("No active fallback plan is configured. No local state was changed.")
  process.exit(1)
}
const failureStartedAt = status === "past_due" ? localState.payment_failure_started_at || subscription.updatedAt || new Date().toISOString() : null
const graceEndsAt = failureStartedAt ? localState.payment_grace_ends_at || new Date(new Date(failureStartedAt).getTime() + 14 * 86400000).toISOString() : null
const graceExpired = status === "past_due" && graceEndsAt && new Date(graceEndsAt).getTime() <= Date.now()
const planKey = status === "paused" || status === "canceled" || graceExpired ? fallbackPlan.data.key : mapping.plan_key
const periodStart = subscription.currentBillingPeriod?.startsAt?.slice(0, 10) || null
const periodEnd = subscription.currentBillingPeriod?.endsAt?.slice(0, 10) || null
const periodStartAt = subscription.currentBillingPeriod?.startsAt || null
const periodEndAt = subscription.currentBillingPeriod?.endsAt || null
const scheduledChange = subscription.scheduledChange
const occurredAt = subscription.updatedAt || new Date().toISOString()
const reconcileEventId = `reconcile:${subscription.id}:${occurredAt}`
const projectionComplete = Boolean(
  localState.provider_price_id &&
  localState.billing_interval &&
  localState.billing_currency &&
  localState.current_period_start_at &&
  localState.current_period_end_at,
)
const sameTimestamp = localState.last_provider_event_at && new Date(occurredAt).getTime() === new Date(localState.last_provider_event_at).getTime()
if (localState.last_provider_event_at && (occurredAt < localState.last_provider_event_at || (sameTimestamp && localState.last_provider_event_id && reconcileEventId <= localState.last_provider_event_id)) && projectionComplete) {
  console.log("Local state is already at least as recent as the Paddle subscription.")
  process.exit(0)
}

let updateQuery = supabase
  .from("workspace_subscriptions")
  .update({
    plan_key: planKey,
    status,
    source: "paddle",
    provider: "paddle",
    provider_environment: environment,
    provider_customer_id: subscription.customerId || null,
    provider_subscription_id: subscription.id,
    provider_price_id: providerPriceId,
    billing_interval: mapping.billing_interval,
    billing_currency: mapping.currency,
    provider_status: status,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    current_period_start_at: periodStartAt,
    current_period_end_at: periodEndAt,
    cancel_at_period_end: scheduledChange?.action === "cancel",
    last_provider_event_at: occurredAt,
    last_provider_event_id: reconcileEventId,
    next_billed_at: subscription.nextBilledAt || null,
    scheduled_change_at: scheduledChange?.effectiveAt || null,
    scheduled_change_action: scheduledChange?.action || null,
    scheduled_effective_at: scheduledChange?.effectiveAt || null,
    payment_failure_started_at: failureStartedAt,
    payment_grace_ends_at: graceEndsAt,
    billing_issue_code: status === "past_due" ? (graceExpired ? "grace_expired" : "past_due") : null,
  })
  .eq("workspace_id", workspace.id)
if (localState.last_provider_event_at && occurredAt > localState.last_provider_event_at) {
  updateQuery = updateQuery.lt("last_provider_event_at", occurredAt)
} else if (localState.last_provider_event_at && sameTimestamp) {
  updateQuery = updateQuery.or(`last_provider_event_at.lt.${occurredAt},and(last_provider_event_at.eq.${occurredAt},last_provider_event_id.lt.${reconcileEventId})`)
} else if (!localState.last_provider_event_at) {
  updateQuery = updateQuery.is("last_provider_event_at", null)
}
const { error: updateError } = await updateQuery
if (updateError) {
  console.error("Could not update local subscription state:", updateError.message)
  process.exit(1)
}

console.log(`Reconciled ${workspace.slug} from Paddle ${environment}.`)
