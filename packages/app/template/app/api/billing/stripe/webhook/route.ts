import { after } from "next/server"
import { NextResponse } from "next/server"
import { BillingConfigurationError } from "@/lib/billing/config"
import { createStripeBillingAdapter } from "@/lib/billing/providers/stripe"
import {
  normalizeStripeEvent,
  processStoredStripeWebhookEvent,
  recordStripeWebhookEvent,
  StripeBillingSyncError,
} from "@/lib/billing/stripe-webhook"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 })

  const rawBody = await request.text()
  if (!rawBody) return NextResponse.json({ error: "Empty webhook body." }, { status: 400 })

  let event
  try {
    const verified = await createStripeBillingAdapter().verifyWebhook(rawBody, signature)
    event = normalizeStripeEvent(verified)
  } catch (error) {
    if (error instanceof BillingConfigurationError) {
      console.error("Stripe webhook configuration is incomplete", { code: error.code })
      return NextResponse.json({ error: "Billing webhook is not configured." }, { status: 503 })
    }
    console.error("Stripe webhook signature or event was rejected", {
      code: error instanceof StripeBillingSyncError ? error.code : "INVALID_WEBHOOK",
    })
    return NextResponse.json({ error: "Invalid Stripe webhook request." }, { status: 400 })
  }

  let stored
  try {
    stored = await recordStripeWebhookEvent(event)
  } catch (error) {
    console.error("Stripe webhook could not be durably recorded", {
      code: error instanceof StripeBillingSyncError ? error.code : "WEBHOOK_STORE_FAILED",
    })
    return NextResponse.json({ error: "Webhook could not be recorded. Stripe may retry this event." }, { status: 503 })
  }

  after(async () => {
    await processStoredStripeWebhookEvent(stored.id)
  })
  return NextResponse.json({ received: true, duplicate: stored.duplicate })
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } })
}
