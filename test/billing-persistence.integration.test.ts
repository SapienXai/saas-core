import { readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  claimBillingWebhookEvent,
  consumeBillingTransition,
  finalizeBillingWebhookEvent,
  recordBillingMutationTransition,
  recordBillingWebhookEvent,
  updateBillingMutationTransition,
  upsertBillingProviderAccount,
} from "../lib/billing/persistence"

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && anonKey && serviceRoleKey ? describe : describe.skip

describe("durable billing persistence fixture", () => {
  it("keeps the additive schema generic and names the retry/consumption boundaries", async () => {
    const migration = await readFile(path.join(process.cwd(), "supabase/migrations/20260909094344_reusable_billing_persistence.sql"), "utf8")
    expect(migration).toContain("create table public.billing_provider_accounts")
    expect(migration).toContain("create table public.billing_mutation_transitions")
    expect(migration).toContain("create table public.billing_transition_consumptions")
    expect(migration).toContain("target_allow_reclaim boolean default false")
    expect(migration).toContain("UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION")
    expect(migration.toLowerCase()).not.toContain("paddle")
    expect(migration.toLowerCase()).not.toContain("restaurant")
  })
})

integration("durable billing persistence against Supabase", () => {
  const service = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  const anonymous = url && anonKey ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  let owner: { id: string; email: string } | null = null
  let ownerClient: SupabaseClient
  let workspaceId = ""

  beforeAll(async () => {
    const stamp = Date.now()
    owner = { id: "", email: `billing-persistence-${stamp}@example.test` }
    const created = await service!.auth.admin.createUser({ email: owner.email, password: "BillingPersistence!2026-password", email_confirm: true })
    if (created.error || !created.data.user) throw created.error || new Error("Could not create billing persistence test account.")
    owner.id = created.data.user.id
    ownerClient = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const session = await ownerClient.auth.signInWithPassword({ email: owner.email, password: "BillingPersistence!2026-password" })
    if (session.error) throw session.error
    const bootstrap = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Billing Persistence ${stamp}`, target_workspace_slug: `billing-persistence-${stamp}` })
    if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Workspace bootstrap failed.")
    workspaceId = bootstrap.data[0].workspace_id
  })

  afterAll(async () => {
    if (workspaceId) await service!.from("workspaces").delete().eq("id", workspaceId)
    if (owner?.id) await service!.auth.admin.deleteUser(owner.id)
  })

  it("scopes provider accounts and keeps duplicate webhook claims idempotent", async () => {
    const anonymousRead = await anonymous!.from("billing_provider_accounts").select("id").limit(1)
    const authenticatedRead = await ownerClient.from("billing_mutation_transitions").select("id").limit(1)
    expect(anonymousRead.error).toBeTruthy()
    expect(authenticatedRead.error).toBeTruthy()

    const account = await upsertBillingProviderAccount({ workspaceId, provider: "fixture", environment: "sandbox", providerAccountId: `account-${Date.now()}` }, service! as any)
    const accountAgain = await upsertBillingProviderAccount({ workspaceId, provider: "fixture", environment: "sandbox", providerAccountId: account.provider_account_id, metadata: { retained: true } }, service! as any)
    expect(accountAgain.id).toBe(account.id)
    const liveAccount = await upsertBillingProviderAccount({ workspaceId, provider: "fixture", environment: "live", providerAccountId: `account-live-${Date.now()}` }, service! as any)
    expect(liveAccount.id).not.toBe(account.id)

    const event = await recordBillingWebhookEvent({ provider: "fixture", environment: "sandbox", providerEventId: `event-${Date.now()}`, eventType: "subscription.changed", occurredAt: new Date(), workspaceId, payload: { fixture: true } }, service! as any)
    const duplicate = await recordBillingWebhookEvent({ provider: "fixture", environment: "sandbox", providerEventId: event.provider_event_id, eventType: "different.event", occurredAt: new Date(), workspaceId, payload: { overwritten: true } }, service! as any)
    expect(duplicate.id).toBe(event.id)
    expect(duplicate.event_type).toBe(event.event_type)

    const leaseToken = randomUUID()
    const first = await claimBillingWebhookEvent({ eventId: event.id, leaseToken, leaseSeconds: 60 }, service! as any)
    const repeat = await claimBillingWebhookEvent({ eventId: event.id, leaseToken, leaseSeconds: 60 }, service! as any)
    const competing = await claimBillingWebhookEvent({ eventId: event.id, leaseToken: randomUUID(), leaseSeconds: 60 }, service! as any)
    expect(first.claimed).toBe(true)
    expect(repeat.claimed).toBe(true)
    expect(repeat.attempts).toBe(first.attempts)
    expect(competing.claimed).toBe(false)
    const finalized = await finalizeBillingWebhookEvent({ eventId: event.id, leaseToken: randomUUID(), status: "processed" }, service! as any)
    expect(finalized.updated).toBe(false)
    const completed = await finalizeBillingWebhookEvent({ eventId: event.id, leaseToken, status: "processed" }, service! as any)
    expect(completed.updated).toBe(true)
    expect(completed.status).toBe("processed")
  })

  it("persists unknown outcomes and consumes a succeeded transition once", async () => {
    const mutation = await service!.from("billing_mutations").insert({ workspace_id: workspaceId, request_key: `fixture-request-${Date.now()}-key`, operation: "plan_change", status: "pending" }).select("id").single()
    if (mutation.error || !mutation.data) throw mutation.error || new Error("Could not create mutation fixture.")
    const key = `transition-${Date.now()}`
    const created = await recordBillingMutationTransition({ mutationId: mutation.data.id, workspaceId, provider: "fixture", environment: "sandbox", transitionKey: key, kind: "upgrade", toPlanKey: "fixture-plan", outcome: { status: "pending" } }, service! as any)
    const duplicate = await recordBillingMutationTransition({ mutationId: mutation.data.id, workspaceId, provider: "fixture", environment: "sandbox", transitionKey: key, kind: "upgrade", state: "failed", outcome: { status: "failed" } }, service! as any)
    expect(created.inserted).toBe(true)
    expect(duplicate.inserted).toBe(false)
    expect(duplicate.state).toBe("pending")

    const unknown = await updateBillingMutationTransition({ transitionId: created.transition_id, state: "unknown", outcome: { status: "unknown", reason: "timeout" } }, service! as any)
    expect(unknown.updated).toBe(true)
    await expect(updateBillingMutationTransition({ transitionId: created.transition_id, state: "failed" }, service! as any)).rejects.toThrow("UNKNOWN_OUTCOME_REQUIRES_RECONCILIATION")
    const succeeded = await updateBillingMutationTransition({ transitionId: created.transition_id, state: "succeeded", outcome: { status: "succeeded" }, providerReference: "fixture-reference" }, service! as any)
    expect(succeeded.state).toBe("succeeded")

    const first = await consumeBillingTransition({ workspaceId, userId: owner!.id, transitionId: created.transition_id }, service! as any)
    const repeat = await consumeBillingTransition({ workspaceId, userId: owner!.id, transitionId: created.transition_id }, service! as any)
    expect(first.consumed).toBe(true)
    expect(repeat.consumed).toBe(false)
    expect(repeat.consumed_at).toBe(first.consumed_at)
  })
})
