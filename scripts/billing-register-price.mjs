import { execFileSync } from "node:child_process"
import { createClient } from "@supabase/supabase-js"

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

let status
try {
  status = JSON.parse(execFileSync("supabase", ["status", "--workdir", ".", "-o", "json"], { encoding: "utf8" }))
} catch {
  console.error("Could not read local Supabase status. Start the isolated project with npm run db:start first.")
  process.exit(1)
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost):55521$/.test(status.API_URL || "")) {
  console.error("Refusing to modify a non-local Supabase project.")
  process.exit(1)
}

const supabase = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const { error: deactivateError } = await supabase
  .from("billing_provider_prices")
  .update({ active: false })
  .eq("provider", "paddle")
  .eq("environment", environment)
  .eq("plan_key", planKey)
  .eq("billing_interval", billingInterval)
  .eq("currency", currency)
  .eq("active", true)
if (deactivateError) {
  console.error("Could not retire the previous Paddle price mapping:", deactivateError.message)
  process.exit(1)
}

const { error } = await supabase
  .from("billing_provider_prices")
  .upsert({
    provider: "paddle",
    environment,
    plan_key: planKey,
    provider_product_id: productId,
    provider_price_id: priceId,
    billing_interval: billingInterval,
    currency,
    active: true,
  }, { onConflict: "provider,environment,provider_price_id" })

if (error) {
  console.error("Could not register the Paddle price mapping:", error.message)
  process.exit(1)
}

console.log(`Registered Paddle ${environment} ${billingInterval} ${currency} price mapping for ${planKey}.`)
