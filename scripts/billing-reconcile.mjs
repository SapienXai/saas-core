import { createClient } from "@supabase/supabase-js"
import { Environment, Paddle } from "@paddle/paddle-node-sdk"

const [workspaceSlug] = process.argv.slice(2)
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

const apiKey = process.env.PADDLE_API_KEY
const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!apiKey || !supabaseUrl || !serviceRoleKey) {
  console.error("Paddle API and server-only Supabase environment variables are required.")
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
  .select("workspace_id, provider, provider_environment, provider_subscription_id, provider_price_id, billing_interval, billing_currency, current_period_start_at, current_period_end_at, last_provider_event_at")
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

const paddle = new Paddle(apiKey, { environment: environment === "sandbox" ? Environment.sandbox : Environment.production })
const subscription = await paddle.subscriptions.get(localState.provider_subscription_id)
const item = subscription.items?.[0]
const providerPriceId = item?.price?.id || null
const { data: mapping, error: mappingError } = await supabase
  .from("billing_provider_prices")
  .select("plan_key, billing_interval, currency")
  .eq("provider", "paddle")
  .eq("environment", environment)
  .eq("provider_price_id", providerPriceId)
  .maybeSingle()
if (mappingError || !mapping) {
  console.error("The current Paddle price is not registered for this environment. No local state was changed.")
  process.exit(1)
}

const status = subscription.status
const { data: fallbackPlan, error: fallbackPlanError } = await supabase
  .from("plans")
  .select("key")
  .eq("active", true)
  .order("sort_order", { ascending: true })
  .order("key", { ascending: true })
  .limit(1)
  .maybeSingle()
if (fallbackPlanError || !fallbackPlan) {
  console.error("No active fallback plan is configured. No local state was changed.")
  process.exit(1)
}
const planKey = status === "paused" || status === "canceled" ? fallbackPlan.key : mapping.plan_key
const periodStart = subscription.currentBillingPeriod?.startsAt?.slice(0, 10) || null
const periodEnd = subscription.currentBillingPeriod?.endsAt?.slice(0, 10) || null
const periodStartAt = subscription.currentBillingPeriod?.startsAt || null
const periodEndAt = subscription.currentBillingPeriod?.endsAt || null
const scheduledChange = subscription.scheduledChange
const occurredAt = subscription.updatedAt || new Date().toISOString()
const projectionComplete = Boolean(
  localState.provider_price_id &&
  localState.billing_interval &&
  localState.billing_currency &&
  localState.current_period_start_at &&
  localState.current_period_end_at,
)
if (localState.last_provider_event_at && occurredAt <= localState.last_provider_event_at && projectionComplete) {
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
    last_provider_event_id: `reconcile:${subscription.id}:${occurredAt}`,
    next_billed_at: subscription.nextBilledAt || null,
    scheduled_change_at: scheduledChange?.effectiveAt || null,
    scheduled_change_action: scheduledChange?.action || null,
    scheduled_effective_at: scheduledChange?.effectiveAt || null,
    billing_issue_code: status === "past_due" ? "past_due" : null,
  })
  .eq("workspace_id", workspace.id)
if (localState.last_provider_event_at && occurredAt > localState.last_provider_event_at) {
  updateQuery = updateQuery.lt("last_provider_event_at", occurredAt)
} else if (localState.last_provider_event_at && projectionComplete) {
  updateQuery = updateQuery.lt("last_provider_event_at", occurredAt)
} else if (!localState.last_provider_event_at) {
  updateQuery = updateQuery.is("last_provider_event_at", null)
}
const { error: updateError } = await updateQuery
if (updateError) {
  console.error("Could not update local subscription state:", updateError.message)
  process.exit(1)
}

console.log(`Reconciled ${workspace.slug} from Paddle ${environment}.`)
