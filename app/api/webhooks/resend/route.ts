import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabase"
import { verifyResendWebhookSignature } from "@/lib/email-delivery"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function statusForEvent(type: string) {
  if (type === "email.delivered") return "delivered" as const
  if (type === "email.bounced") return "bounced" as const
  if (["email.failed", "email.complained", "email.suppressed"].includes(type)) return "failed" as const
  return null
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const secret = process.env.RESEND_WEBHOOK_SECRET || ""
  const valid = verifyResendWebhookSignature({
    rawBody,
    secret,
    svixId: request.headers.get("svix-id"),
    svixTimestamp: request.headers.get("svix-timestamp"),
    svixSignature: request.headers.get("svix-signature"),
  })
  if (!valid) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 })

  let payload: any
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload." }, { status: 400 })
  }

  const status = statusForEvent(String(payload?.type || ""))
  const providerMessageId = String(payload?.data?.email_id || payload?.data?.message_id || payload?.data?.id || "").trim()
  if (!status || !providerMessageId) return NextResponse.json({ received: true })

  const providerEventId = String(request.headers.get("svix-id") || payload?.id || `${providerMessageId}:${payload.type}:${payload?.created_at || payload?.data?.created_at || ""}`).trim()
  const reason = String(
    payload?.data?.reason ||
    payload?.data?.error ||
    payload?.data?.status ||
    payload?.data?.failed?.reason ||
    payload?.data?.bounce?.message ||
    `Resend reported ${status}.`,
  ).slice(0, 2000)
  const failureType = String(
    payload?.data?.error_type ||
    payload?.data?.type ||
    payload?.data?.status ||
    payload?.data?.failed?.reason ||
    payload?.data?.bounce?.type ||
    reason,
  ).toLowerCase()
  const pauseDelivery = ["email.bounced", "email.complained", "email.suppressed"].includes(String(payload?.type)) || /(permanent|invalid|suppressed|unsubscribed|mailbox|undeliverable|hard|complaint)/i.test(failureType)
  const rawEventAt = payload?.created_at || payload?.data?.created_at || null
  const parsedEventAt = rawEventAt ? new Date(String(rawEventAt)) : null
  const eventAt = parsedEventAt && Number.isFinite(parsedEventAt.getTime()) ? parsedEventAt.toISOString() : null
  const { error } = await createServiceRoleClient().rpc("apply_email_delivery_webhook", {
    target_provider_event_id: providerEventId,
    target_provider_message_id: providerMessageId,
    target_event_type: String(payload.type),
    target_event_at: eventAt,
    target_error: reason,
    target_pause_delivery: pauseDelivery,
    target_payload: payload,
  } as any)
  if (error) {
    console.error("Could not apply Resend delivery event:", error.message)
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 })
  }
  return NextResponse.json({ received: true })
}
