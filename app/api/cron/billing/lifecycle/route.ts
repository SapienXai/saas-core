import { isBillingProviderConfigured } from "@/lib/billing/providers"
import { expirePaymentGracePeriods, processDuePaddleBillingWebhookEvents, processDueStripeBillingWebhookEvents } from "@/lib/billing/lifecycle"
import { processDuePaddleIntervalChanges } from "@/lib/billing/paddle-interval-cutover"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return Response.json({ error: "Cron is not configured." }, { status: 503 })

  const authorization = request.headers.get("authorization")
  if (authorization !== `Bearer ${cronSecret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 })
  }

  try {
    const paddleSandbox = process.env.SAAS_CORE_BILLING_PROVIDER === "paddle" && isBillingProviderConfigured()
    const [gracePeriods, webhooks] = await Promise.all([
      expirePaymentGracePeriods(),
      paddleSandbox ? processDuePaddleBillingWebhookEvents() : processDueStripeBillingWebhookEvents(),
    ])
    const intervalChanges = paddleSandbox ? await processDuePaddleIntervalChanges() : null
    return Response.json({ ok: true, ...gracePeriods, webhooks, ...(intervalChanges && { intervalChanges }) })
  } catch (error) {
    console.error("Billing lifecycle cron failed", { error: error instanceof Error ? error.message : String(error) })
    return Response.json({ error: "Billing lifecycle could not be completed." }, { status: 500 })
  }
}
