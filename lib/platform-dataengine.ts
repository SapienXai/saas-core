import "server-only"

import { audit } from "@/lib/platform-audit"
import { retryTrackedEmail } from "@/lib/email-delivery"
import { normalizeBusinessEmail } from "@/lib/claimable-restaurants"
import { createServiceRoleClient } from "@/lib/supabase"
import { requirePlatformRole, requirePlatformWriteAccess } from "@/lib/platform-authorization"
import {
  getDataEngineImportBatch,
  listDataEngineImportBatches,
  overrideDataEngineLeadReadiness,
  prepareDataEngineLeadBanner,
  retryDataEngineLeadPublish,
  reviewDataEngineLeads,
} from "@/lib/dataengine-reservevia"

export async function listPlatformDataEngineBatches() {
  await requirePlatformRole()
  return listDataEngineImportBatches()
}

export async function getPlatformDataEngineBatch(batchId: string) {
  await requirePlatformRole()
  return getDataEngineImportBatch(batchId)
}

function requireMutationReason(reason: string) {
  const normalized = reason?.trim()
  if (!normalized || normalized.length < 3 || normalized.length > 500) throw new Error("A mutation reason between 3 and 500 characters is required.")
  return normalized
}

export async function preparePlatformDataEngineLeadBanner(leadId: string, reason: string) {
  const access = await requirePlatformWriteAccess()
  const normalizedReason = requireMutationReason(reason)
  const result = await prepareDataEngineLeadBanner(leadId)
  await audit({ actorUserId: access.access.userId, action: "dataengine.lead_banner_staged", entityType: "dataengine_import_lead", entityId: leadId, after: { sourceType: result.sourceType, width: result.width, height: result.height }, reason: normalizedReason })
  return result
}

export async function reviewPlatformDataEngineLeads(input: Parameters<typeof reviewDataEngineLeads>[0]) {
  const access = await requirePlatformWriteAccess()
  const result = await reviewDataEngineLeads(input)
  await audit({ actorUserId: access.access.userId, action: input.decision === "approve" ? "dataengine.leads_approved" : "dataengine.leads_rejected", entityType: "dataengine_import_batch", entityId: input.batchId, after: { selected: input.leadIds.length, results: result.results.map((item: any) => ({ id: item.id, status: item.status })) }, reason: input.reason })
  return result
}

export async function retryPlatformDataEngineLeadPublish(leadId: string, reason: string) {
  const access = await requirePlatformWriteAccess()
  const normalizedReason = requireMutationReason(reason)
  const result = await retryDataEngineLeadPublish(leadId)
  await audit({ actorUserId: access.access.userId, action: "dataengine.lead_publish_retried", entityType: "dataengine_import_lead", entityId: leadId, after: result.result, reason: normalizedReason })
  return result
}

export async function overridePlatformDataEngineLeadReadiness(input: Parameters<typeof overrideDataEngineLeadReadiness>[0]) {
  const access = await requirePlatformWriteAccess()
  const result = await overrideDataEngineLeadReadiness({ ...input, actorUserId: access.access.userId })
  await audit({ actorUserId: access.access.userId, action: "dataengine.lead_readiness_overridden", entityType: "dataengine_import_lead", entityId: input.leadId, after: { readinessStatus: result.readinessStatus }, reason: input.reason })
  return result
}

export async function retryPlatformDataEngineEmail(eventId: string, reason: string) {
  const access = await requirePlatformWriteAccess()
  const normalizedReason = requireMutationReason(reason)
  const result = await retryTrackedEmail(eventId)
  await audit({ actorUserId: access.access.userId, action: "dataengine.email_delivery_retried", entityType: "email_delivery_event", entityId: eventId, after: { success: result.success }, reason: normalizedReason })
  return { success: true as const, result }
}

export async function correctPlatformDataEngineBusinessEmail(input: { restaurantId: string; email: string; reason: string }) {
  const access = await requirePlatformWriteAccess()
  const email = normalizeBusinessEmail(input.email)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !input.reason.trim()) throw new Error("A valid business email and correction reason are required.")
  const service = createServiceRoleClient()
  const { data: profile, error } = await service.from("restaurant_claim_profiles").update({ business_contact_email: email, normalized_business_contact_email: email, business_email_delivery_status: "healthy", business_email_last_error: null, business_email_paused_at: null }).eq("restaurant_id", input.restaurantId).eq("source", "dataengine").in("ownership_status", ["unclaimed", "claim_pending"]).select("restaurant_id").maybeSingle()
  if (error || !profile) throw new Error(error?.message || "The unclaimed DataEngine restaurant could not be found.")
  const { error: leadError } = await service.from("dataengine_import_leads").update({ business_contact_email: email, normalized_business_contact_email: email }).eq("restaurant_id", input.restaurantId)
  if (leadError) throw new Error(leadError.message)
  await audit({ actorUserId: access.access.userId, action: "dataengine.business_email_corrected", entityType: "restaurant_claim_profile", entityId: input.restaurantId, after: { emailDomain: email.split("@").pop() }, reason: input.reason })
  return { success: true as const }
}
