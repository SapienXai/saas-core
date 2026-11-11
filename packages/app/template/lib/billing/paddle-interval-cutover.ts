import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"
import { reconcilePaddleSubscription } from "./paddle-webhook"
import { getProviderPriceByProviderId } from "./price-mapping"
import { deferredIntervalResumeRequestKey } from "./provider"
import { getPaddleConfig, readPaddleIntervalApproval, resumePaddleDeferredInterval, retrievePaddleSubscription, stagePaddleDeferredInterval } from "./providers/paddle"
import { BillingProjectionError, claimWorkspaceProjection, releaseWorkspaceProjection } from "./subscription-projection"

type Database = ReturnType<typeof createServiceRoleClient>

async function cutOverWorkspace(db: Database, workspaceId: string, now: Date) {
  const { environment } = getPaddleConfig()
  const lease = await claimWorkspaceProjection(db, workspaceId, 120)
  try {
    const { data: row, error } = await db.from("workspace_subscriptions")
      .select("provider_subscription_id,provider_customer_id,scheduled_change_at")
      .eq("workspace_id", workspaceId).eq("provider", "paddle").eq("provider_environment", environment)
      .eq("scheduled_change_action", "pause").lte("scheduled_change_at", now.toISOString()).maybeSingle()
    if (error) throw new Error(error.message)
    if (!row?.provider_subscription_id || !row.provider_customer_id || !row.scheduled_change_at) return null

    const subscriptionId = row.provider_subscription_id
    const remote = await retrievePaddleSubscription(subscriptionId)
    if (remote.customerId !== row.provider_customer_id || remote.customData.workspace_id !== workspaceId ||
        remote.customData.billing_environment !== environment || remote.customData.billing_provider !== "paddle") {
      throw new Error("Paddle interval change does not match the Workspace subscription.")
    }
    const change = remote.deferredIntervalChange
    if (!change || change.phase === "resumed") return { subscriptionId, resumed: false }
    if (change.phase === "scheduled") return null
    if (Date.parse(change.effectiveAt) !== Date.parse(row.scheduled_change_at)) {
      throw new Error("Paddle interval change does not match the persisted billing boundary.")
    }

    const requestKey = deferredIntervalResumeRequestKey(change.scheduleId)
    const [approval, previousAttempt] = await Promise.all([
      readPaddleIntervalApproval(workspaceId, change.scheduleId, change.targetPlanKey, change.effectiveAt),
      db.from("billing_mutations").select("id,status,created_at")
        .eq("workspace_id", workspaceId).eq("operation", "resume").eq("request_key", requestKey).maybeSingle(),
    ])
    if (previousAttempt.error) throw new Error(previousAttempt.error.message)
    if (approval !== "succeeded") return { subscriptionId, resumed: false }

    if (previousAttempt.data) {
      // A process can stop between persisting this claim and Paddle's response.
      // Reconcile provider state without sending another potentially billable POST.
      if (previousAttempt.data.status === "pending" && now.getTime() - Date.parse(previousAttempt.data.created_at) > 120_000) {
        await markResumeUnknown(db, previousAttempt.data.id)
      }
      return null
    }

    const target = await getProviderPriceByProviderId("paddle", change.targetPriceId, environment)
    if (!target || target.billing_interval !== "month" || target.plan_key !== change.targetPlanKey ||
        target.provider_product_id !== remote.items[0]?.productId) throw new Error("Paddle monthly price is no longer mapped.")

    const binding = {
      workspaceId, subscriptionId, customerId: row.provider_customer_id,
      scheduleId: change.scheduleId, effectiveAt: change.effectiveAt, targetPriceId: change.targetPriceId,
    }
    await stagePaddleDeferredInterval(binding)

    let attemptId: string | undefined
    try {
      const resumed = await resumePaddleDeferredInterval(binding, async () => {
        const { data: attempt, error: claimError } = await db.from("billing_mutations").insert({
          workspace_id: workspaceId, request_key: requestKey, operation: "resume", status: "pending",
          result: { scheduleId: change.scheduleId, providerReference: subscriptionId, effectiveAt: change.effectiveAt },
        }).select("id").single()
        if (claimError?.code === "23505") return false
        if (claimError || !attempt) throw new Error(claimError?.message || "Could not claim the Paddle resume.")
        attemptId = attempt.id
        return true
      })
      return resumed ? { subscriptionId, resumed } : null
    } catch (error) {
      if (attemptId) await markResumeUnknown(db, attemptId)
      throw error
    }
  } finally {
    await releaseWorkspaceProjection(db, workspaceId, lease.leaseToken, lease.revision)
  }
}

async function markResumeUnknown(db: Database, id: string) {
  const { error } = await db.from("billing_mutations").update({
    status: "unknown", error_code: "PADDLE_INTERVAL_RESUME_UNCONFIRMED",
  }).eq("id", id).eq("status", "pending")
  if (error) throw new Error(error.message)
}

/** Drain only owner-approved Paddle changes that have reached the recorded boundary. */
export async function processDuePaddleIntervalChanges(now = new Date()) {
  const { environment } = getPaddleConfig()
  const db = createServiceRoleClient()
  const { data, error } = await db.from("workspace_subscriptions").select("workspace_id")
    .eq("provider", "paddle").eq("provider_environment", environment)
    .eq("scheduled_change_action", "pause").lte("scheduled_change_at", now.toISOString())
    .order("updated_at", { ascending: true }).order("workspace_id").limit(3)
  if (error) throw new Error(error.message)

  let resumed = 0
  let failed = 0
  for (const row of data) {
    try {
      const result = await cutOverWorkspace(db, row.workspace_id, now)
      if (!result) continue
      if (result.resumed) resumed += 1
      await reconcilePaddleSubscription(result.subscriptionId, row.workspace_id)
    } catch (error) {
      if (error instanceof BillingProjectionError && ["PROJECTION_BUSY", "RENEWAL_PENDING_PAYMENT"].includes(error.code)) continue
      failed += 1
      console.error("Paddle interval cutover could not be reconciled", { workspaceId: row.workspace_id })
    }
  }
  return { due: data.length, resumed, failed }
}
