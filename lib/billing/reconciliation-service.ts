import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"
import { requireBillingProviderBinding } from "./providers"
import { reconcilePaddleCheckoutSession, reconcilePaddleSubscription } from "./paddle-webhook"
import { reconcileStripeCheckoutSession, reconcileStripeSubscription } from "./stripe-webhook"

/** Use the stored provider even after the deployment switches its checkout provider. */
export async function reconcileBillingSubscription(subscriptionId: string, workspaceId: string) {
  const { data, error } = await createServiceRoleClient().from("workspace_subscriptions")
    .select("provider, provider_environment")
    .eq("workspace_id", workspaceId)
    .eq("provider_subscription_id", subscriptionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error("Subscription is not linked to this Workspace.")
  const { provider } = requireBillingProviderBinding(data.provider, data.provider_environment)
  return provider === "paddle"
    ? reconcilePaddleSubscription(subscriptionId, workspaceId)
    : reconcileStripeSubscription(subscriptionId, workspaceId)
}

export async function reconcileBillingCheckoutSession(checkoutSessionId: string, workspaceId: string) {
  const { data, error } = await createServiceRoleClient().from("billing_checkout_sessions")
    .select("provider, environment")
    .eq("workspace_id", workspaceId)
    .eq("provider_transaction_id", checkoutSessionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { status: "failed" as const, workspaceId }
  const { provider } = requireBillingProviderBinding(data.provider, data.environment)
  return provider === "paddle"
    ? reconcilePaddleCheckoutSession(checkoutSessionId, workspaceId)
    : reconcileStripeCheckoutSession(checkoutSessionId, workspaceId)
}
