import { after } from "next/server"
import { NextResponse } from "next/server"
import { BillingConfigurationError, verifyPaddleWebhook } from "@/lib/billing/paddle-client"
import {
  normalizePaddleEvent,
  processStoredPaddleWebhookEvent,
  recordPaddleWebhookEvent,
} from "@/lib/billing/webhook"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const signature = request.headers.get("paddle-signature")
  if (!signature) return NextResponse.json({ error: "Missing webhook signature." }, { status: 400 })

  const rawBody = await request.text()
  if (!rawBody) return NextResponse.json({ error: "Empty webhook body." }, { status: 400 })

  try {
    const verifiedEvent = await verifyPaddleWebhook(rawBody, signature)
    const event = normalizePaddleEvent(verifiedEvent)
    const stored = await recordPaddleWebhookEvent(event)

    // The durable claim decides whether this delivery is new, already
    // processed, leased by another worker, or ready for a failed-event retry.
    after(async () => {
      await processStoredPaddleWebhookEvent(stored.id)
    })

    return NextResponse.json({ received: true, duplicate: stored.duplicate })
  } catch (error) {
    if (error instanceof BillingConfigurationError) {
      console.error("Paddle webhook configuration is incomplete", { code: error.code })
      return NextResponse.json({ error: "Billing webhook is not configured." }, { status: 503 })
    }

    console.error("Paddle webhook rejected", {
      message: error instanceof Error ? error.message : "Invalid webhook request.",
    })
    return NextResponse.json({ error: "Invalid webhook request." }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405, headers: { Allow: "POST" } })
}
