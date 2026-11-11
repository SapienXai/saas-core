/** Provider-neutral billing contracts. Keep SDK types out of this module. */

/** Provider names are open strings so products can select their own adapter. */
export type BillingProviderName = string
export type BillingProviderEnvironment = "sandbox" | "live"
export type BillingProviderInterval = "month" | "year"

export type ProviderCheckoutRequest = {
  mutationId: string
  workspaceId: string
  planKey: string
  interval: BillingProviderInterval
  priceId: string
  customerId?: string | null
  customerEmail?: string | null
  successUrl: string
  cancelUrl: string
}

export type ProviderCheckoutSession = {
  id: string
  url: string | null
  livemode: boolean
  status: "open" | "complete" | "expired" | "unknown"
  paymentStatus: "paid" | "unpaid" | "no_payment_required" | "unknown"
  customerId: string | null
  subscriptionId: string | null
  workspaceId: string | null
  mutationId: string | null
  metadata: Record<string, string>
}

export type ProviderPortalRequest = {
  customerId: string
  subscriptionId?: string
  /** The authenticated Workspace owner’s email, verified by the app’s identity provider. */
  confirmedBuyerEmail?: string
  returnUrl: string
}

export type ProviderPortalSession = { url: string }

export type ProviderSubscriptionStatus = "active" | "trialing" | "past_due" | "paused" | "canceled" | "pending" | "expired" | "unpaid"

export function deferredIntervalResumeRequestKey(scheduleId: string) {
  return "paddle-interval-resume:" + scheduleId
}

export type ProviderSubscriptionSnapshot = {
  id: string
  status: ProviderSubscriptionStatus
  providerStatus: string
  issueCode: string | null
  livemode: boolean
  customerId: string | null
  nextBilledAt: string | null
  currentBillingPeriod: { startsAt: string; endsAt: string } | null
  cancelAtPeriodEnd: boolean
  cancelEffectiveAt: string | null
  hasPendingUpdate: boolean
  scheduleId: string | null
  scheduledPlan: { priceId: string; effectiveAt: string } | null
  deferredIntervalChange?: {
    scheduleId: string
    effectiveAt: string
    currentPriceId: string
    targetPriceId: string
    targetPlanKey: string
    phase: "scheduled" | "paused" | "resumed"
  }
  collectionPaused: boolean
  customData: Record<string, string>
  items: Array<{ id: string; priceId: string | null; productId: string | null; quantity: number }>
}

export type ProviderPriceSnapshot = {
  id: string
  productId: string
  amount: number | null
  currency: string
  interval: string | null
  intervalCount: number | null
  livemode: boolean
}

export type ProviderInvoiceSummary = {
  id: string
  number: string | null
  status: string | null
  currency: string
  amountDue: number
  amountPaid: number
  createdAt: string | null
  hostedInvoiceUrl: string | null
  pdfUrl: string | null
  customerId: string | null
  subscriptionId: string | null
}

export type ProviderPaymentMethodSummary = {
  type: string
  last4: string | null
  expiryMonth: number | null
  expiryYear: number | null
}

export type ProviderSubscriptionChangePreview = {
  amount: number
  amountDue: number
  creditToBalance: number
  action: "charge" | "credit" | "none"
  currency: string
  nextPaymentAttempt: string | null
  recurringAmount?: number
  recurringCurrency?: string
}

/** Narrow surface used by application services; provider-specific calls stay in adapters. */
export interface BillingProviderAdapter {
  readonly provider: BillingProviderName
  readonly environment: BillingProviderEnvironment
  createCheckoutSession(request: ProviderCheckoutRequest): Promise<ProviderCheckoutSession>
  retrieveCheckoutSession(id: string): Promise<ProviderCheckoutSession>
  expireCheckoutSession(id: string): Promise<ProviderCheckoutSession>
  retrieveSubscription(id: string): Promise<ProviderSubscriptionSnapshot>
  hasPaidRenewal?(subscription: ProviderSubscriptionSnapshot): Promise<boolean>
  createPortalSession(request: ProviderPortalRequest): Promise<ProviderPortalSession>
  retrievePrice(id: string): Promise<ProviderPriceSnapshot>
  getCustomerPaymentMethod(customerId: string): Promise<ProviderPaymentMethodSummary | null>
  listInvoices(customerId: string, subscriptionId?: string | null): Promise<ProviderInvoiceSummary[]>
  retrieveInvoice(id: string, expectedCustomerId: string, expectedSubscriptionId?: string | null): Promise<ProviderInvoiceSummary>
  previewSubscriptionChange(input: { subscriptionId: string; customerId: string; itemId: string; priceId: string; prorationDate: number; resetBillingCycle?: boolean; effectiveAt?: string }): Promise<ProviderSubscriptionChangePreview>
  updateSubscriptionPrice(input: { subscriptionId: string; itemId: string; priceId: string; prorationDate: number; resetBillingCycle?: boolean; idempotencyKey: string; metadata?: Record<string, string> }): Promise<ProviderSubscriptionSnapshot>
  schedulePlanChange(input: { subscriptionId: string; currentPriceId: string; targetPriceId: string; targetPlanKey: string; targetInterval: BillingProviderInterval; periodEnd: number; intervalCount: number; mutationId: string; idempotencyKey: string }): Promise<{ scheduleId: string; effectiveAt: string }>
  releaseSchedule(subscriptionId: string, scheduleId: string, idempotencyKey: string, mutationKind?: "undo_plan_change" | "cancel"): Promise<void>
  scheduleCancellation(subscriptionId: string, idempotencyKey: string): Promise<ProviderSubscriptionSnapshot>
  undoScheduledCancellation(subscriptionId: string, idempotencyKey: string): Promise<ProviderSubscriptionSnapshot>
  verifyWebhook(rawBody: string, signature: string): Promise<unknown>
}
