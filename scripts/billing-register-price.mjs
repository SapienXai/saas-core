import { execFileSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"
import Stripe from "stripe"

const [planKey, environment, productId, priceId, billingInterval = "month", currency = "USD"] = process.argv.slice(2)
if (!/^[a-z][a-z0-9_-]{0,63}$/.test(planKey || "") || !["sandbox", "live"].includes(environment) || !productId || !priceId || !["month", "year"].includes(billingInterval) || !/^[A-Z]{3}$/.test(currency)) {
  console.error("Usage: npm run billing:register-price -- <plan-key> <sandbox|live> <product-id> <price-id> [month|year] [ISO-currency]")
  process.exit(1)
}

if (process.env.NODE_ENV === "production" && process.env.BILLING_ALLOW_LIVE_PRICE_REGISTRATION !== "true") {
  console.error("Refusing live provider mapping mutation without BILLING_ALLOW_LIVE_PRICE_REGISTRATION=true.")
  process.exit(1)
}
if (environment === "live" && process.env.BILLING_ALLOW_LIVE_PRICE_REGISTRATION !== "true") {
  console.error("Refusing live provider mapping mutation without BILLING_ALLOW_LIVE_PRICE_REGISTRATION=true.")
  process.exit(1)
}

const configuredEnvironment = process.env.STRIPE_ENVIRONMENT
const apiKey = process.env.STRIPE_SECRET_KEY
const accountId = process.env.STRIPE_ACCOUNT_ID
if (configuredEnvironment !== environment || !apiKey || !accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
  console.error("Matching STRIPE_ENVIRONMENT, STRIPE_SECRET_KEY, and STRIPE_ACCOUNT_ID are required.")
  process.exit(1)
}
if (!(environment === "sandbox" ? /^(sk|rk)_test_/.test(apiKey) : /^(sk|rk)_live_/.test(apiKey))) {
  console.error("STRIPE_SECRET_KEY does not match the requested billing environment.")
  process.exit(1)
}

const stripe = new Stripe(apiKey, { apiVersion: "2026-09-30.endive", maxNetworkRetries: 1 })
const account = await stripe.accounts.retrieve(null).catch(() => null)
if (!account || account.id !== accountId) {
  console.error("Stripe account binding could not be verified. No local state was changed.")
  process.exit(1)
}
let price
try {
  price = await stripe.prices.retrieve(priceId, { expand: ["product"] })
} catch {
  console.error("Could not retrieve the Stripe Price from the configured account.")
  process.exit(1)
}
const actualProductId = typeof price.product === "string" ? price.product : price.product.id
if (!price.active || actualProductId !== productId || price.livemode !== (environment === "live") ||
  price.currency.toUpperCase() !== currency || price.recurring?.interval !== billingInterval || price.recurring.interval_count !== 1) {
  console.error("The Stripe Price does not match the requested product, environment, currency, or billing interval.")
  process.exit(1)
}
const product = typeof price.product === "string" ? await stripe.products.retrieve(actualProductId).catch(() => null) : price.product
if (!product || ("deleted" in product && product.deleted) || !product.active) {
  console.error("The Stripe Product is missing, deleted, or inactive.")
  process.exit(1)
}

let status
try {
  status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { encoding: "utf8" }))
} catch {
  console.error("Could not read local Supabase status. Start the isolated project with npm run db:start first.")
  process.exit(1)
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost):55621$/.test(status.API_URL || "")) {
  console.error("Refusing to modify a non-local Supabase project.")
  process.exit(1)
}

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { error: deactivateError } = await supabase
  .from("billing_provider_prices")
  .update({ active: false })
  .eq("provider", "stripe")
  .eq("environment", environment)
  .eq("plan_key", planKey)
  .eq("billing_interval", billingInterval)
  .eq("currency", currency)
  .eq("active", true)
if (deactivateError) {
  console.error("Could not retire the previous Stripe price mapping:", deactivateError.message)
  process.exit(1)
}

const { error } = await supabase
  .from("billing_provider_prices")
  .upsert({
    provider: "stripe",
    environment,
    plan_key: planKey,
    provider_product_id: productId,
    provider_price_id: priceId,
    billing_interval: billingInterval,
    currency,
    active: true,
  }, { onConflict: "provider,environment,provider_price_id" })

if (error) {
  console.error("Could not register the Stripe price mapping:", error.message)
  process.exit(1)
}

console.log(`Registered Stripe ${environment} ${billingInterval} ${currency} Price mapping for ${planKey}.`)
