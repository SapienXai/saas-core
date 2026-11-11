import { after } from "next/server"
import { BillingConfigurationError } from "@/lib/billing/config"
import { getPaddleConfig, verifyPaddleWebhook } from "@/lib/billing/providers/paddle"
import { normalizePaddleEvent, processStoredPaddleWebhookEvent, recordPaddleEvent } from "@/lib/billing/paddle-webhook"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const signature = request.headers.get("paddle-signature")
  if (!signature) return Response.json({ error: "Missing Paddle signature." }, { status: 400 })
  let event
  try {
    const { webhookSecret } = getPaddleConfig()
    event = normalizePaddleEvent(verifyPaddleWebhook(Buffer.from(await request.arrayBuffer()), signature, webhookSecret))
  } catch (error) {
    const status = error instanceof BillingConfigurationError ? 503 : 400
    return Response.json({ error: "Paddle webhook was not accepted." }, { status })
  }
  try {
    const receipt = await recordPaddleEvent(event)
    after(async () => {
      try {
        await processStoredPaddleWebhookEvent(receipt.id)
      } catch {
        console.error("Paddle webhook receipt processing could not be started.", { receiptId: receipt.id })
      }
    })
    return Response.json({ received: true })
  } catch {
    return Response.json({ error: "Paddle webhook could not be recorded." }, { status: 503 })
  }
}
