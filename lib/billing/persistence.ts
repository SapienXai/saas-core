import "server-only"

import { randomUUID } from "node:crypto"
import type { BillingEnvironment, BillingTransitionKind, BillingTransitionState } from "@sapienx/saas-core"
import type { CoreDataClient } from "@sapienx/saas-core/postgres"
import { createServiceRoleClient } from "@/lib/supabase"
import type { Database, Json } from "@/types/supabase"

export type BillingDatabaseClient = Pick<CoreDataClient<Database["public"]>, "from" | "rpc">
export type BillingProviderAccount = Database["public"]["Tables"]["billing_provider_accounts"]["Row"]
export type BillingWebhookEvent = Database["public"]["Tables"]["billing_webhook_events"]["Row"]
export type BillingMutationTransition = Database["public"]["Tables"]["billing_mutation_transitions"]["Row"]
export type BillingTransitionConsumption = Database["public"]["Tables"]["billing_transition_consumptions"]["Row"]

export type BillingPersistenceJson = Record<string, unknown>

export type UpsertBillingProviderAccountInput = {
  workspaceId: string
  provider: string
  environment: BillingEnvironment
  providerAccountId: string
  providerCustomerId?: string | null
  metadata?: BillingPersistenceJson
}

export type RecordBillingWebhookEventInput = {
  provider: string
  environment: BillingEnvironment
  providerEventId: string
  eventType: string
  occurredAt: string | Date
  providerObjectId?: string | null
  workspaceId?: string | null
  payload?: BillingPersistenceJson
  receivedAt?: string | Date
  maxAttempts?: number
}

export type ClaimBillingWebhookEventInput = {
  eventId: string
  leaseToken?: string
  leaseSeconds?: number
  allowReclaim?: boolean
  now?: string | Date
}

export type FinalizeBillingWebhookEventInput = {
  eventId: string
  leaseToken: string
  status: "processed" | "ignored" | "failed"
  errorCode?: string | null
  errorMessage?: string | null
  nextAttemptAt?: string | Date | null
  now?: string | Date
}

export type RecordBillingMutationTransitionInput = {
  mutationId: string
  workspaceId: string
  provider: string
  environment: BillingEnvironment
  transitionKey: string
  kind: BillingTransitionKind
  state?: BillingTransitionState
  fromPlanKey?: string | null
  toPlanKey?: string | null
  effectiveAt?: string | Date | null
  providerReference?: string | null
  outcome?: BillingPersistenceJson
  maxAttempts?: number
}

export type UpdateBillingMutationTransitionInput = {
  transitionId: string
  state: BillingTransitionState
  outcome?: BillingPersistenceJson | null
  errorCode?: string | null
  errorMessage?: string | null
  providerReference?: string | null
  expectedState?: BillingTransitionState | null
  nextAttemptAt?: string | Date | null
  now?: string | Date
}

export type ConsumeBillingTransitionInput = {
  workspaceId: string
  userId: string
  transitionId: string
  now?: string | Date
}

export type BillingWebhookClaim = {
  claimed: boolean
  event_id: string
  provider: string | null
  environment: string | null
  provider_event_id: string | null
  workspace_id: string | null
  status: string
  attempts: number
  max_attempts: number
  payload: Json
  lease_token: string | null
  lease_until: string | null
  next_attempt_at: string | null
}

export type BillingWebhookFinalization = {
  updated: boolean
  event_id: string
  status: string
  attempts: number
  max_attempts: number
  next_attempt_at: string | null
  processed_at: string | null
  lease_token: string | null
  lease_until: string | null
}

export type BillingMutationTransitionResult = {
  transition_id: string
  inserted: boolean
  mutation_id: string
  workspace_id: string
  provider: string
  environment: string
  transition_key: string
  kind: string
  state: string
  from_plan_key: string | null
  to_plan_key: string | null
  effective_at: string | null
  provider_reference: string | null
  outcome: Json
  attempts: number
  max_attempts: number
  next_attempt_at: string | null
  last_attempt_at: string | null
  last_error_code: string | null
  last_error_message: string | null
}

export type BillingMutationTransitionUpdate = {
  updated: boolean
  transition_id: string
  state: string
  attempts: number
  max_attempts: number
  next_attempt_at: string | null
  provider_reference: string | null
  outcome: Json
  last_error_code: string | null
  last_error_message: string | null
}

export type BillingTransitionConsumptionResult = {
  consumed: boolean
  transition_id: string
  workspace_id: string
  user_id: string
  state: string
  kind: string | null
  effective_at: string | null
  outcome: Json
  consumed_at: string | null
}

function database(client?: BillingDatabaseClient): BillingDatabaseClient {
  return client || createServiceRoleClient()
}

function textValue(value: string | undefined | null, field: string) {
  if (!value || !value.trim()) throw new Error(`${field} is required.`)
  return value.trim()
}

function environmentValue(value: BillingEnvironment) {
  if (value !== "sandbox" && value !== "live") throw new Error("environment must be sandbox or live.")
  return value
}

function isoValue(value: string | Date | null | undefined, field: string, nullable = false) {
  if (value == null) {
    if (nullable) return null
    throw new Error(`${field} is required.`)
  }
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid timestamp.`)
  return date.toISOString()
}

function objectValue(value: BillingPersistenceJson | undefined | null, field: string): BillingPersistenceJson {
  if (value == null) return {}
  if (Array.isArray(value) || typeof value !== "object") throw new Error(`${field} must be an object.`)
  return value
}

function resultRow<T>(data: unknown, error: { message: string } | null, operation: string): T {
  if (error) throw new Error(`${operation}: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error(`${operation}: the database returned no row.`)
  return row as T
}

export async function upsertBillingProviderAccount(
  input: UpsertBillingProviderAccountInput,
  client?: BillingDatabaseClient,
): Promise<BillingProviderAccount> {
  const db = database(client) as any
  const workspaceId = textValue(input.workspaceId, "workspaceId")
  const provider = textValue(input.provider, "provider")
  const environment = environmentValue(input.environment)
  const providerAccountId = textValue(input.providerAccountId, "providerAccountId")
  const providerCustomerId = input.providerCustomerId == null ? null : textValue(input.providerCustomerId, "providerCustomerId")
  const metadata = objectValue(input.metadata, "metadata")
  const { data, error } = await db.rpc("upsert_billing_provider_account", {
    target_workspace_id: workspaceId,
    target_provider: provider,
    target_environment: environment,
    target_provider_account_id: providerAccountId,
    target_provider_customer_id: providerCustomerId,
    target_metadata: metadata,
  })
  const row = resultRow<Record<string, unknown>>(data, error, "upsertBillingProviderAccount")
  return {
    id: String(row.account_id),
    workspace_id: String(row.workspace_id),
    provider: String(row.provider),
    environment: String(row.environment),
    provider_account_id: String(row.provider_account_id),
    provider_customer_id: row.provider_customer_id == null ? null : String(row.provider_customer_id),
    metadata: row.metadata as Json,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export async function recordBillingWebhookEvent(
  input: RecordBillingWebhookEventInput,
  client?: BillingDatabaseClient,
): Promise<BillingWebhookEvent> {
  const db = database(client) as any
  const provider = textValue(input.provider, "provider")
  const environment = environmentValue(input.environment)
  const providerEventId = textValue(input.providerEventId, "providerEventId")
  const eventType = textValue(input.eventType, "eventType")
  const occurredAt = isoValue(input.occurredAt, "occurredAt")
  const receivedAt = isoValue(input.receivedAt, "receivedAt", true)
  const maxAttempts = input.maxAttempts ?? 8
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("maxAttempts must be between 1 and 20.")
  const payload = objectValue(input.payload, "payload")
  const { error: insertError } = await db
    .from("billing_webhook_events")
    .upsert({
      provider,
      environment,
      provider_event_id: providerEventId,
      event_type: eventType,
      occurred_at: occurredAt,
      provider_object_id: input.providerObjectId ?? null,
      workspace_id: input.workspaceId ?? null,
      payload,
      ...(receivedAt ? { received_at: receivedAt } : {}),
      max_attempts: maxAttempts,
    }, { onConflict: "provider,environment,provider_event_id", ignoreDuplicates: true })
  if (insertError) throw new Error(`recordBillingWebhookEvent: ${insertError.message}`)
  const { data, error } = await db
    .from("billing_webhook_events")
    .select("*")
    .eq("provider", provider)
    .eq("environment", environment)
    .eq("provider_event_id", providerEventId)
    .single()
  if (error) throw new Error(`recordBillingWebhookEvent: ${error.message}`)
  return data as BillingWebhookEvent
}

export async function claimBillingWebhookEvent(
  input: ClaimBillingWebhookEventInput,
  client?: BillingDatabaseClient,
): Promise<BillingWebhookClaim> {
  const db = database(client) as any
  const eventId = textValue(input.eventId, "eventId")
  const leaseToken = textValue(input.leaseToken || randomUUID(), "leaseToken")
  const leaseSeconds = input.leaseSeconds ?? 300
  if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600) throw new Error("leaseSeconds must be between 1 and 3600.")
  const now = isoValue(input.now || new Date(), "now")
  const { data, error } = await db.rpc("claim_billing_webhook_event", {
    target_event_id: eventId,
    target_lease_token: leaseToken,
    target_lease_seconds: leaseSeconds,
    target_allow_reclaim: input.allowReclaim ?? false,
    target_now: now,
  })
  return resultRow<BillingWebhookClaim>(data, error, "claimBillingWebhookEvent")
}

export async function finalizeBillingWebhookEvent(
  input: FinalizeBillingWebhookEventInput,
  client?: BillingDatabaseClient,
): Promise<BillingWebhookFinalization> {
  const db = database(client) as any
  const eventId = textValue(input.eventId, "eventId")
  const leaseToken = textValue(input.leaseToken, "leaseToken")
  const now = isoValue(input.now || new Date(), "now")
  const nextAttemptAt = isoValue(input.nextAttemptAt, "nextAttemptAt", true)
  const { data, error } = await db.rpc("finalize_billing_webhook_event", {
    target_event_id: eventId,
    target_lease_token: leaseToken,
    target_status: input.status,
    target_error_code: input.errorCode ?? null,
    target_error_message: input.errorMessage ?? null,
    target_next_attempt_at: nextAttemptAt,
    target_now: now,
  })
  return resultRow<BillingWebhookFinalization>(data, error, "finalizeBillingWebhookEvent")
}

export async function recordBillingMutationTransition(
  input: RecordBillingMutationTransitionInput,
  client?: BillingDatabaseClient,
): Promise<BillingMutationTransitionResult> {
  const db = database(client) as any
  const mutationId = textValue(input.mutationId, "mutationId")
  const workspaceId = textValue(input.workspaceId, "workspaceId")
  const provider = textValue(input.provider, "provider")
  const environment = environmentValue(input.environment)
  const transitionKey = textValue(input.transitionKey, "transitionKey")
  const maxAttempts = input.maxAttempts ?? 3
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) throw new Error("maxAttempts must be between 1 and 20.")
  const { data, error } = await db.rpc("record_billing_mutation_transition", {
    target_mutation_id: mutationId,
    target_workspace_id: workspaceId,
    target_provider: provider,
    target_environment: environment,
    target_transition_key: transitionKey,
    target_kind: input.kind,
    target_state: input.state ?? "pending",
    target_from_plan_key: input.fromPlanKey ?? null,
    target_to_plan_key: input.toPlanKey ?? null,
    target_effective_at: isoValue(input.effectiveAt, "effectiveAt", true),
    target_provider_reference: input.providerReference ?? null,
    target_outcome: objectValue(input.outcome, "outcome"),
    target_max_attempts: maxAttempts,
  })
  return resultRow<BillingMutationTransitionResult>(data, error, "recordBillingMutationTransition")
}

export async function updateBillingMutationTransition(
  input: UpdateBillingMutationTransitionInput,
  client?: BillingDatabaseClient,
): Promise<BillingMutationTransitionUpdate> {
  const db = database(client) as any
  const transitionId = textValue(input.transitionId, "transitionId")
  const { data, error } = await db.rpc("update_billing_mutation_transition", {
    target_transition_id: transitionId,
    target_state: input.state,
    target_outcome: input.outcome == null ? null : objectValue(input.outcome, "outcome"),
    target_error_code: input.errorCode ?? null,
    target_error_message: input.errorMessage ?? null,
    target_provider_reference: input.providerReference ?? null,
    target_expected_state: input.expectedState ?? null,
    target_next_attempt_at: isoValue(input.nextAttemptAt, "nextAttemptAt", true),
    target_now: isoValue(input.now || new Date(), "now"),
  })
  return resultRow<BillingMutationTransitionUpdate>(data, error, "updateBillingMutationTransition")
}

export async function consumeBillingTransition(
  input: ConsumeBillingTransitionInput,
  client?: BillingDatabaseClient,
): Promise<BillingTransitionConsumptionResult> {
  const db = database(client) as any
  const workspaceId = textValue(input.workspaceId, "workspaceId")
  const userId = textValue(input.userId, "userId")
  const transitionId = textValue(input.transitionId, "transitionId")
  const { data, error } = await db.rpc("consume_billing_transition", {
    target_workspace_id: workspaceId,
    target_user_id: userId,
    target_transition_id: transitionId,
    target_now: isoValue(input.now || new Date(), "now"),
  })
  return resultRow<BillingTransitionConsumptionResult>(data, error, "consumeBillingTransition")
}

export const saveBillingProviderAccount = upsertBillingProviderAccount
export const saveBillingWebhookEvent = recordBillingWebhookEvent
export const claimBillingEvent = claimBillingWebhookEvent
export const finalizeBillingEvent = finalizeBillingWebhookEvent
export const saveBillingMutationTransition = recordBillingMutationTransition
export const consumeBillingTransitionOnce = consumeBillingTransition
