import "server-only"

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { sendEmail, type SendEmailParams } from "@/lib/email-service"
import { createServiceRoleClient } from "@/lib/supabase"

type DeliveryContext = {
  kind: string
  reservationId?: string | null
  restaurantId?: string | null
  metadata?: Record<string, unknown>
  dedupeKey?: string
  maxAttempts?: number
}

export async function sendTrackedEmail(params: SendEmailParams, context: DeliveryContext) {
  const service = createServiceRoleClient()
  const dedupeKey = context.dedupeKey || `${context.kind}:${context.reservationId || "none"}:${params.to.trim().toLowerCase()}`
  let { data: event, error: eventError } = await service
    .from("email_delivery_events")
    .upsert({
      kind: context.kind,
      reservation_id: context.reservationId || null,
      restaurant_id: context.restaurantId || null,
      recipient_email: params.to,
      status: "pending",
      metadata: context.metadata || {},
      payload: params,
      dedupe_key: dedupeKey,
      next_attempt_at: new Date().toISOString(),
      max_attempts: Math.max(1, Math.min(context.maxAttempts || 5, 10)),
    }, { onConflict: "dedupe_key", ignoreDuplicates: true })
    .select("id, status, provider_message_id")
    .maybeSingle()

  if (eventError || !event) {
    if (!eventError) {
      const existing = await service.from("email_delivery_events").select("id, status, provider_message_id").eq("dedupe_key", dedupeKey).maybeSingle()
      event = existing.data
      eventError = existing.error
    }
  }
  if (eventError || !event) {
    const error = { message: eventError?.message || "The transactional email outbox could not be persisted.", code: "outbox_persistence_failed" }
    console.error("Could not create email delivery outbox event:", error.message)
    return { success: false as const, error, emailDisabled: false, deliveryEventId: null, providerMessageId: null, durable: false as const }
  }
  if (["sent", "delivered"].includes(event.status)) return { success: true as const, data: { id: event.provider_message_id }, deliveryEventId: event.id, providerMessageId: event.provider_message_id, durable: true as const }
  if (["bounced", "paused"].includes(event.status)) return { success: false as const, error: { message: `Email delivery is ${event.status}.`, code: event.status }, deliveryEventId: event.id, providerMessageId: event.provider_message_id, durable: true as const }
  const result = await deliverTrackedEmail(event.id)
  return { ...result, deliveryEventId: event.id, durable: true as const }
}

export async function deliverTrackedEmail(eventId: string) {
  const service = createServiceRoleClient()
  const leaseToken = randomUUID()
  const { data: claimResult, error: claimError } = await service.rpc("claim_email_delivery_event", { target_event_id: eventId, target_lease_token: leaseToken } as any)
  if (claimError) throw new Error(claimError.message)
  const claim = Array.isArray(claimResult) ? claimResult[0] : claimResult
  if (!claim?.claimed) {
    if (["sent", "delivered"].includes(claim?.current_status)) return { success: true as const, data: { id: null }, providerMessageId: null }
    const retryable = ["pending", "retrying", "sending"].includes(claim?.current_status || "")
    return { success: false as const, error: { message: `Email event is ${claim?.current_status || "not available"}.`, code: claim?.current_status || "not_available" }, retryable }
  }
  const payload = claim.payload as SendEmailParams
  const result = await sendEmail({ ...payload, idempotencyKey: `reservevia-email-${eventId}` })
  const providerMessageId = result.success && result.data && typeof result.data === "object" && "id" in result.data ? String(result.data.id || "") || null : null
  const providerResult = result.success && providerMessageId
  const errorMessage = !providerResult ? (result.success ? "Email provider returned no message identifier." : result.error && typeof result.error === "object" && "message" in result.error ? String(result.error.message) : "Email provider rejected the message.") : ""
  const errorCode = !providerResult ? (result.success ? "provider_missing_message_id" : result.error && typeof result.error === "object" && "code" in result.error ? String(result.error.code) : "provider_error") : ""
  const attemptCount = Number(claim.attempt_count || 1)
  const maxAttempts = Number(claim.max_attempts || 5)
  const transient = !["invalid_recipient", "invalid_parameter", "validation_error", "missing_api_key"].includes(errorCode)
  const retryable = !providerResult && transient && attemptCount < maxAttempts
  const nextAttemptAt = new Date(Date.now() + Math.min(60 * 60 * 1000, 2 ** Math.max(0, attemptCount - 1) * 60_000)).toISOString()
  const update = providerResult
    ? { status: "sent", provider: "resend", provider_message_id: providerMessageId, sent_at: new Date().toISOString(), last_error: null, next_attempt_at: null, lease_token: null, lease_until: null }
    : { status: retryable ? "retrying" : "failed", provider: "resend", failed_at: retryable ? null : new Date().toISOString(), last_error: errorMessage.slice(0, 2000), next_attempt_at: retryable ? nextAttemptAt : null, lease_token: null, lease_until: null }
  const { error: updateError } = await service.from("email_delivery_events").update(update).eq("id", eventId).eq("lease_token", leaseToken)
  if (updateError) throw new Error(`Email delivery state could not be persisted: ${updateError.message}`)
  const attemptStatus = providerResult ? "sent" : retryable ? "retrying" : "failed"
  const { error: attemptError } = await service.from("email_delivery_attempts").update({ status: attemptStatus, provider_message_id: providerMessageId, error: providerResult ? null : errorMessage.slice(0, 2000), finished_at: new Date().toISOString() }).eq("delivery_event_id", eventId).eq("attempt_number", attemptCount)
  if (attemptError) console.error("Email delivery attempt history could not be persisted:", attemptError.message)
  if (providerResult) {
    const { data: storedProviderEvents } = await service.from("email_provider_webhook_events").select("provider_event_id, provider_message_id, event_type, event_at, payload").eq("provider_message_id", providerMessageId)
    for (const providerEvent of storedProviderEvents || []) {
      const payload = providerEvent.payload as Record<string, any>
      const failureReason = String(payload?.data?.reason || payload?.data?.error || payload?.data?.status || payload?.data?.failed?.reason || payload?.data?.bounce?.message || `Resend reported ${providerEvent.event_type}.`).slice(0, 2000)
      const failureType = String(payload?.data?.error_type || payload?.data?.type || payload?.data?.status || payload?.data?.failed?.reason || payload?.data?.bounce?.type || failureReason).toLowerCase()
      const { error: replayError } = await service.rpc("apply_email_delivery_webhook", {
        target_provider_event_id: providerEvent.provider_event_id,
        target_provider_message_id: providerEvent.provider_message_id,
        target_event_type: providerEvent.event_type,
        target_event_at: providerEvent.event_at,
        target_error: failureReason,
        target_pause_booking: ["email.bounced", "email.complained", "email.suppressed"].includes(providerEvent.event_type) || /(permanent|invalid|suppressed|unsubscribed|mailbox|undeliverable|hard|complaint)/i.test(failureType),
        target_payload: providerEvent.payload,
      } as any)
      if (replayError) console.error("Stored provider webhook could not be reconciled:", replayError.message)
    }
  }
  if (!retryable && !providerResult) {
    const { data: event } = await service.from("email_delivery_events").select("kind, restaurant_id").eq("id", eventId).maybeSingle()
    if (event?.kind === "unclaimed_business_reservation" && event.restaurant_id) {
      await service.from("restaurant_claim_profiles").update({ business_email_delivery_status: "paused", business_email_last_error: errorMessage.slice(0, 2000), business_email_paused_at: new Date().toISOString() }).eq("restaurant_id", event.restaurant_id).eq("source", "dataengine").in("ownership_status", ["unclaimed", "claim_pending"])
    }
  }
  return providerResult ? { ...result, providerMessageId, retryable: false, nextAttemptAt: null } : { success: false as const, error: { message: errorMessage, code: errorCode }, providerMessageId, retryable, nextAttemptAt: retryable ? nextAttemptAt : null }
}

export async function retryTrackedEmail(eventId: string) {
  const service = createServiceRoleClient()
  const { data: event, error } = await service.from("email_delivery_events").select("id, status, restaurant_id, attempt_count, max_attempts").eq("id", eventId).maybeSingle()
  if (error || !event) throw new Error(error?.message || "Email delivery event not found.")
  if (event.status === "bounced" || event.status === "paused") throw new Error("Hard-bounced email delivery is paused until the business email is corrected.")
  const { error: updateError } = await service.from("email_delivery_events").update({ status: "retrying", next_attempt_at: new Date().toISOString(), failed_at: null, last_error: null, lease_token: null, lease_until: null, max_attempts: Math.max(Number(event.max_attempts || 5), Number(event.attempt_count || 0) + 3) }).eq("id", eventId).in("status", ["failed", "retrying", "pending"])
  if (updateError) throw new Error(updateError.message)
  return deliverTrackedEmail(eventId)
}

export function verifyResendWebhookSignature(input: {
  rawBody: string
  secret: string
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
  nowMs?: number
}) {
  if (!input.svixId || !input.svixTimestamp || !input.svixSignature || !input.secret) return false
  const timestamp = Number(input.svixTimestamp)
  if (!Number.isFinite(timestamp) || Math.abs((input.nowMs || Date.now()) - timestamp * 1000) > 5 * 60 * 1000) return false

  const encodedSecret = input.secret.replace(/^whsec_/, "")
  let secretBytes: Buffer
  try {
    secretBytes = Buffer.from(encodedSecret, "base64")
  } catch {
    return false
  }
  const signedPayload = `${input.svixId}.${input.svixTimestamp}.${input.rawBody}`
  const expected = createHmac("sha256", secretBytes).update(signedPayload).digest("base64")
  return input.svixSignature.split(" ").some((signature) => {
    const [version, value] = signature.split(",", 2)
    if (version !== "v1" || !value) return false
    const actual = Buffer.from(value, "base64")
    const expectedBytes = Buffer.from(expected, "base64")
    return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes)
  })
}
