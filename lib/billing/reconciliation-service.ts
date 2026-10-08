import "server-only"

import { reconcileStripeCheckoutSession, reconcileStripeSubscription } from "./stripe-webhook"

/** Provider routing is centralized here; product actions stay vendor-neutral. */
export async function reconcileBillingSubscription(subscriptionId: string, workspaceId: string) {
  return reconcileStripeSubscription(subscriptionId, workspaceId)
}

export async function reconcileBillingCheckoutSession(checkoutSessionId: string, workspaceId: string) {
  return reconcileStripeCheckoutSession(checkoutSessionId, workspaceId)
}
