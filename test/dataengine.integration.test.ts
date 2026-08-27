import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { randomUUID } from "node:crypto"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ""
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
const describeLocal = /^https?:\/\/(127\.0\.0\.1|localhost):54521$/.test(url) && Boolean(anonKey && serviceRoleKey) ? describe : describe.skip

describeLocal("DataEngine ReserveVia private import boundary", () => {
  let service: SupabaseClient
  let clientId = ""
  let batchId = ""
  let leaseBatchId = ""
  let emailEventId = ""

  beforeAll(async () => {
    service = createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const client = await service.from("api_clients").insert({ name: `DataEngine integration ${Date.now()}`, credential_hash: `test-${Date.now()}`, scopes: ["dataengine:reservevia:write"], rate_limit_profile: "internal" }).select("id").single()
    if (client.error || !client.data) throw client.error ?? new Error("Could not create test API client")
    clientId = client.data.id
    const batch = await service.from("dataengine_import_batches").insert({ external_batch_id: `integration-${Date.now()}`, contract_version: "reservevia.dataengine.leads.v1", api_client_id: clientId, request_hash: "a".repeat(64) }).select("id").single()
    if (batch.error || !batch.data) throw batch.error ?? new Error("Could not create DataEngine test batch")
    batchId = batch.data.id
  })

  afterAll(async () => {
    if (emailEventId) await service.from("email_delivery_events").delete().eq("id", emailEventId)
    if (leaseBatchId) await service.from("dataengine_import_batches").delete().eq("id", leaseBatchId)
    if (batchId) await service.from("dataengine_import_batches").delete().eq("id", batchId)
    if (clientId) await service.from("api_clients").delete().eq("id", clientId)
  })

  it("keeps import tables private and reserves cross-batch identities atomically", async () => {
    const lead = await service.from("dataengine_import_leads").insert({ batch_id: batchId, external_candidate_id: "place:integration-1", source_place_id: "integration-1", name: "Integration House", source_payload: {} }).select("id").single()
    expect(lead.error).toBeNull()
    const first = await service.rpc("claim_dataengine_import_identity", { target_identity_key: "place:integration-1", target_lead_id: lead.data?.id, target_restaurant_id: null })
    expect(first.error).toBeNull()
    leaseBatchId = first.data?.[0]?.batch_id || ""
    expect(first.data?.[0]).toMatchObject({ is_owner: true, first_lead_id: lead.data?.id })
    const duplicateLead = await service.from("dataengine_import_leads").insert({ batch_id: batchId, external_candidate_id: "place:integration-2", source_place_id: "integration-1", name: "Integration House Duplicate", source_payload: {} }).select("id").single()
    expect(duplicateLead.error).toBeNull()
    const second = await service.rpc("claim_dataengine_import_identity", { target_identity_key: "place:integration-1", target_lead_id: duplicateLead.data?.id, target_restaurant_id: null })
    expect(second.data?.[0]).toMatchObject({ is_owner: false, first_lead_id: lead.data?.id })

    const anonymous = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    const privateRead = await anonymous.from("dataengine_import_leads").select("business_contact_email").eq("id", lead.data?.id)
    expect(privateRead.data || []).toEqual([])
  })

  it("does not turn an active or failed ingest lease into a successful replay", async () => {
    const first = await service.rpc("claim_dataengine_import_batch", { target_external_batch_id: `lease-${Date.now()}`, target_contract_version: "reservevia.dataengine.leads.v1", target_api_client_id: clientId, target_request_hash: "b".repeat(64), target_total_leads: 1, target_lease_token: randomUUID() } as any)
    expect(first.error).toBeNull()
    expect(first.data?.[0]).toMatchObject({ lease_acquired: true, replayable: false })
    const externalBatchId = first.data?.[0]?.batch_id ? (await service.from("dataengine_import_batches").select("external_batch_id").eq("id", first.data[0].batch_id).single()).data?.external_batch_id : "missing"
    const second = await service.rpc("claim_dataengine_import_batch", { target_external_batch_id: externalBatchId, target_contract_version: "reservevia.dataengine.leads.v1", target_api_client_id: clientId, target_request_hash: "b".repeat(64), target_total_leads: 1, target_lease_token: randomUUID() } as any)
    expect(second.error).toBeNull()
    expect(second.data?.[0]).toMatchObject({ lease_acquired: false, replayable: false })
    const conflict = await service.rpc("claim_dataengine_import_batch", { target_external_batch_id: externalBatchId, target_contract_version: "reservevia.dataengine.leads.v1", target_api_client_id: clientId, target_request_hash: "c".repeat(64), target_total_leads: 1, target_lease_token: randomUUID() } as any)
    expect(conflict.error?.message).toContain("IDEMPOTENCY_CONFLICT")
  })

  it("keeps provider delivery events idempotent and monotonic", async () => {
    const inserted = await service.from("email_delivery_events").insert({ kind: "unclaimed_business_reservation", recipient_email: "integration@example.test", status: "sent", provider_message_id: `integration-mail-${Date.now()}` }).select("id, provider_message_id").single()
    expect(inserted.error).toBeNull()
    emailEventId = inserted.data?.id || ""
    const delivered = await service.rpc("apply_email_delivery_webhook", { target_provider_event_id: `evt-delivered-${Date.now()}`, target_provider_message_id: inserted.data?.provider_message_id, target_event_type: "email.delivered", target_event_at: new Date().toISOString(), target_error: null, target_pause_booking: false, target_payload: {} } as any)
    expect(delivered.error).toBeNull()
    const complained = await service.rpc("apply_email_delivery_webhook", { target_provider_event_id: `evt-complained-${Date.now()}`, target_provider_message_id: inserted.data?.provider_message_id, target_event_type: "email.complained", target_event_at: new Date().toISOString(), target_error: "spam complaint", target_pause_booking: true, target_payload: {} } as any)
    expect(complained.error).toBeNull()
    const afterComplaint = await service.from("email_delivery_events").select("status").eq("id", emailEventId).single()
    expect(afterComplaint.data?.status).toBe("failed")
    const bounced = await service.rpc("apply_email_delivery_webhook", { target_provider_event_id: `evt-bounced-${Date.now()}`, target_provider_message_id: inserted.data?.provider_message_id, target_event_type: "email.bounced", target_event_at: new Date().toISOString(), target_error: "hard bounce", target_pause_booking: true, target_payload: {} } as any)
    expect(bounced.error).toBeNull()
    const lateDelivered = await service.rpc("apply_email_delivery_webhook", { target_provider_event_id: `evt-late-${Date.now()}`, target_provider_message_id: inserted.data?.provider_message_id, target_event_type: "email.delivered", target_event_at: new Date().toISOString(), target_error: null, target_pause_booking: false, target_payload: {} } as any)
    expect(lateDelivered.error).toBeNull()
    const current = await service.from("email_delivery_events").select("status").eq("id", emailEventId).single()
    expect(current.data?.status).toBe("bounced")
  })
})
