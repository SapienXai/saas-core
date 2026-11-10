import "server-only"

import { getBillingProviderName } from "./providers"
import { reconcilePaddleCheckoutSession, reconcilePaddleSubscription } from "./paddle-webhook"
import { reconcileStripeCheckoutSession, reconcileStripeSubscription } from "./stripe-webhook"

/** Provider routing is centralized here; product actions stay vendor-neutral. */
export async function reconcileBillingSubscription(subscriptionId: string, workspaceId: string) {
  return getBillingProviderName() === "paddle"
    ? reconcilePaddleSubscription(subscriptionId, workspaceId)
    : reconcileStripeSubscription(subscriptionId, workspaceId)
}

export async function reconcileBillingCheckoutSession(checkoutSessionId: string, workspaceId: string) {
  return getBillingProviderName() === "paddle"
    ? reconcilePaddleCheckoutSession(checkoutSessionId, workspaceId)
    : reconcileStripeCheckoutSession(checkoutSessionId, workspaceId)
}
