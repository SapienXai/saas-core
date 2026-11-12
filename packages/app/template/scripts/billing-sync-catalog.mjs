import { readFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

const argumentsList = process.argv.slice(2)
const catalogPath = argumentsList.find((value) => !value.startsWith("--")) || "product.catalog.json"
const dryRun = argumentsList.includes("--dry-run")
const deactivateMissing = argumentsList.includes("--deactivate-missing")

function fail(message) {
  console.error(message)
  process.exit(1)
}

function isPlanKey(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(value)
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function normalizePrices(prices) {
  if (prices === undefined) return {}
  if (!isObject(prices)) fail("Every plan prices value must be an object keyed by billing interval.")
  const normalized = {}
  for (const [interval, price] of Object.entries(prices)) {
    if (!isObject(price) || (price.amount !== null && typeof price.amount !== "number") || typeof price.currency !== "string" || !/^[A-Z]{3}$/.test(price.currency)) {
      fail(`Invalid price for interval ${interval}. Use { amount: number|null, currency: ISO-4217 }.`)
    }
    normalized[interval] = { amount: price.amount, currency: price.currency }
    if (price.providerPriceId) console.warn(`Ignoring providerPriceId for ${interval}; register provider mappings separately so catalog sync cannot overwrite live IDs.`)
  }
  return normalized
}

function normalizeCatalog(value) {
  if (!isObject(value) || !Array.isArray(value.plans) || !Array.isArray(value.usageMetrics)) {
    fail("A product catalog must contain plans and usageMetrics arrays.")
  }
  const keys = new Set()
  const plans = value.plans.map((plan, index) => {
    if (!isObject(plan) || !isPlanKey(plan.key) || keys.has(plan.key)) fail(`Invalid or duplicate product plan key: ${plan?.key || "missing"}`)
    if (typeof plan.name !== "string" || !plan.name.trim()) fail(`Plan ${plan.key} must have a display name.`)
    if (plan.description !== undefined && (typeof plan.description !== "string" || !plan.description.trim())) fail(`Plan ${plan.key} description must be non-empty copy.`)
    if (plan.features !== undefined && !isObject(plan.features)) fail(`Plan ${plan.key} features must be an object.`)
    if (plan.limits !== undefined && !isObject(plan.limits)) fail(`Plan ${plan.key} limits must be an object.`)
    if (plan.recommended !== undefined && typeof plan.recommended !== "boolean") fail(`Plan ${plan.key} recommended must be a boolean.`)
    keys.add(plan.key)
    const prices = normalizePrices(plan.prices)
    return {
      key: plan.key,
      name: plan.name.trim(),
      ...(plan.description === undefined ? {} : { description: plan.description.trim() }),
      sort_order: Number.isInteger(plan.sort_order) && plan.sort_order >= 0 ? plan.sort_order : index,
      active: plan.active !== false,
      features: plan.features || {},
      limits: plan.limits || {},
      metadata: {
        ...(isObject(plan.metadata) ? plan.metadata : {}),
        ...(plan.recommended === undefined ? {} : { recommended: plan.recommended }),
        ...(Object.keys(prices).length ? { pricing: prices } : {}),
      },
    }
  })
  const usageMetrics = value.usageMetrics.map((metric) => {
    if (!isObject(metric) || !isPlanKey(metric.key) || typeof metric.name !== "string" || !metric.name.trim()) fail(`Invalid product usage metric: ${metric?.key || "missing"}`)
    return { key: metric.key, name: metric.name.trim(), unit: typeof metric.unit === "string" ? metric.unit : null }
  })
  if (!isPlanKey(value.defaultPlanKey) || !keys.has(value.defaultPlanKey)) fail(`defaultPlanKey must name an existing active product plan.`)
  const defaultPlan = plans.find((plan) => plan.key === value.defaultPlanKey)
  if (!defaultPlan?.active) fail(`defaultPlanKey ${value.defaultPlanKey} must name an active product plan.`)
  if (!Object.prototype.hasOwnProperty.call(defaultPlan.limits, "core.workspaces")) fail(`The default plan ${value.defaultPlanKey} must explicitly define limits.core.workspaces; use null only for intentional unlimited workspaces.`)
  return { plans, usageMetrics, defaultPlanKey: value.defaultPlanKey || null }
}

const catalog = normalizeCatalog(JSON.parse(await readFile(catalogPath, "utf8")))
const neon = process.env.NEXT_PUBLIC_SAAS_CORE_BACKEND === "neon"
const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!neon && (!url || !serviceKey)) fail("Catalog sync requires server-only SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.")
if (!neon && /publishable|anon/i.test(serviceKey)) fail("Catalog sync requires a service role key, never a publishable/anon key.")
const supabase = neon
  ? (await import("@sapienx/saas-core/postgres")).createNeonServerDataClient({ role: "service_role" })
  : createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const existingResult = await supabase.from("plans").select("key, metadata, active")
if (existingResult.error) fail(`Could not read the Core plan catalog: ${existingResult.error.message}`)
const existing = new Map((existingResult.data || []).map((plan) => [plan.key, plan]))
const writes = []

for (const plan of catalog.plans) {
  const oldMetadata = isObject(existing.get(plan.key)?.metadata) ? existing.get(plan.key).metadata : {}
  const nextMetadata = { ...oldMetadata, ...plan.metadata }
  writes.push({ ...plan, metadata: nextMetadata })
}

const missingExisting = [...existing.keys()].filter((key) => !catalog.plans.some((plan) => plan.key === key))

if (!dryRun) {
  const { data, error } = await supabase.rpc("sync_core_catalog", {
    target_plans: writes,
    target_default_plan_key: catalog.defaultPlanKey,
    target_deactivate_missing: deactivateMissing,
  })
  if (error) fail(`Could not synchronize the Core plan catalog: ${error.message}`)
  const result = Array.isArray(data) ? data[0] : data
  if (!result || result.configured_default_plan_key !== catalog.defaultPlanKey) fail("Core catalog sync did not persist the configured default plan.")
  // The baseline sync RPC predates the optional presentation column. Keep the
  // catalog sync compatible with already-migrated databases while persisting
  // descriptions when the additive plan-management migration is present.
  for (const plan of writes) {
    if (plan.description === undefined) continue
    const { error: descriptionError } = await supabase.from("plans").update({ description: plan.description }).eq("key", plan.key)
    if (descriptionError) fail(`Could not persist the description for plan ${plan.key}: ${descriptionError.message}`)
  }
}

console.log(JSON.stringify({
  status: "PASS",
  dryRun,
  catalogPath,
  defaultPlanKey: catalog.defaultPlanKey,
  plans: catalog.plans.map((plan) => plan.key),
  usageMetrics: catalog.usageMetrics.map((metric) => metric.key),
  synchronized: dryRun ? 0 : catalog.plans.length,
  deactivated: deactivateMissing ? missingExisting : [],
  providerMappingsUntouched: true,
}, null, 2))
