import "server-only"

import { createHash } from "node:crypto"
import Stripe from "stripe"
import { assertBillingMutationsEnabled, assertStripeBillingReady, getStripeBillingConfig, type StripeBillingConfig } from "../config"
import type {
  BillingProviderEnvironment,
  BillingProviderAdapter,
  ProviderCheckoutRequest,
  ProviderCheckoutSession,
  ProviderPortalRequest,
  ProviderPortalSession,
  ProviderSubscriptionSnapshot,
  ProviderSubscriptionStatus,
  ProviderPriceSnapshot,
  ProviderInvoiceSummary,
} from "../provider"

export const STRIPE_API_VERSION = "2026-09-30.endive" as const

const verifiedStripeAccountBindings = new Set<string>()

export type StripePriceSummary = ProviderPriceSnapshot
export type StripeInvoiceSummary = ProviderInvoiceSummary
export type StripeBillingAdapter = BillingProviderAdapter

function getStripeClient(config = getStripeBillingConfig()) {
  return new Stripe(config.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 20_000,
  })
}

function normalizeCheckoutSession(session: Stripe.Checkout.Session): ProviderCheckoutSession {
  const checkoutStatus: ProviderCheckoutSession["status"] = (() => {
    switch (session.status) {
      case "open": return "open"
      case "complete": return "complete"
      case "expired": return "expired"
      default: return "unknown"
    }
  })()
  const paymentStatus: ProviderCheckoutSession["paymentStatus"] = (() => {
    switch (session.payment_status) {
      case "paid": return "paid"
      case "unpaid": return "unpaid"
      case "no_payment_required": return "no_payment_required"
      default: return "unknown"
    }
  })()
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id ?? null
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id ?? null
  return {
    id: session.id,
    url: session.url,
    livemode: session.livemode,
    status: checkoutStatus,
    paymentStatus,
    customerId,
    subscriptionId,
    workspaceId: session.metadata?.workspace_id ?? null,
    mutationId: session.metadata?.billing_mutation_id ?? null,
    metadata: { ...(session.metadata || {}) },
  }
}

/** Stripe accepts a stable, eight-letter integration identifier. */
export function getStripeIntegrationIdentifier(mutationId: string) {
  if (!mutationId.trim()) throw new Error("A billing mutation ID is required.")
  const digest = createHash("sha256").update(`placedj:${mutationId}`).digest()
  return Array.from(digest.subarray(0, 8), (byte) => String.fromCharCode(97 + (byte % 26))).join("")
}

export function getStripeMutationIdempotencyKey(mutationId: string, step: "mutation_marker" | "schedule_release" | "schedule_cancellation") {
  if (!mutationId.trim()) throw new Error("A billing mutation ID is required.")
  return `${mutationId}_${step}`
}

function unixSecondsToIso(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function isCoreBillingSchedule(schedule: Stripe.SubscriptionSchedule | null | undefined) {
  return schedule?.metadata?.billing_provider === "stripe" &&
    ["saas-core", "placedj"].includes(schedule.metadata.billing_integration)
}

export function buildStripeScheduleCreateParams(subscriptionId: string): Stripe.SubscriptionScheduleCreateParams {
  return { from_subscription: subscriptionId }
}

export function buildStripeSchedulePhaseDuration(interval: "month" | "year", intervalCount: number) {
  if (!Number.isInteger(intervalCount) || intervalCount < 1) throw new Error("A schedule phase requires a positive interval count.")
  return { interval, interval_count: intervalCount }
}

function normalizeSubscriptionStatus(value: string): { status: ProviderSubscriptionStatus; issueCode: string | null } {
  switch (value) {
    case "active": return { status: "active", issueCode: null }
    case "trialing": return { status: "trialing", issueCode: null }
    case "past_due": return { status: "past_due", issueCode: null }
    case "paused": return { status: "paused", issueCode: null }
    case "canceled": return { status: "canceled", issueCode: null }
    case "incomplete": return { status: "pending", issueCode: null }
    case "incomplete_expired": return { status: "expired", issueCode: null }
    case "unpaid": return { status: "unpaid", issueCode: null }
    default: return { status: "pending", issueCode: "unsupported_subscription_status" }
  }
}

export function normalizeStripeSubscription(subscription: Stripe.Subscription): ProviderSubscriptionSnapshot {
  const itemRows = subscription.items.data
  const items = itemRows.map((item) => {
    const price = item.price
    const priceId = typeof price === "string" ? price : price?.id ?? null
    const product = typeof price === "string" ? null : price?.product
    const productId = typeof product === "string" ? product : product?.id ?? null
    return { id: item.id, priceId, productId, quantity: item.quantity ?? 1 }
  })
  if (items.length !== 1 || !items[0]?.priceId || items[0].quantity !== 1) {
    throw new Error("Stripe subscription must contain exactly one registered recurring item with quantity one.")
  }

  const periods = itemRows.map((item) => ({ start: item.current_period_start, end: item.current_period_end }))
  const starts = periods.map((period) => unixSecondsToIso(period.start)).filter((value): value is string => Boolean(value))
  const ends = periods.map((period) => unixSecondsToIso(period.end)).filter((value): value is string => Boolean(value))
  const startsAt = starts.length ? starts.reduce((earliest, value) => value < earliest ? value : earliest) : null
  const endsAt = ends.length ? ends.reduce((latest, value) => value > latest ? value : latest) : null
  const currentBillingPeriod = startsAt && endsAt && new Date(endsAt).getTime() > new Date(startsAt).getTime()
    ? { startsAt, endsAt }
    : null
  const cancelEffectiveAt = unixSecondsToIso(subscription.cancel_at) || (subscription.cancel_at_period_end ? endsAt : null)
  const status = normalizeSubscriptionStatus(subscription.status)
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id ?? null
  const collectionPaused = Boolean(subscription.pause_collection)
  const activeSchedule = typeof subscription.schedule === "object" && subscription.schedule?.status === "active" ? subscription.schedule : null
  if (activeSchedule && activeSchedule.livemode !== subscription.livemode) throw new Error("Stripe subscription schedule mode does not match its subscription.")
  const ownsSchedule = isCoreBillingSchedule(activeSchedule)
  const schedule = ownsSchedule ? activeSchedule : null
  const currentPhaseEnd = schedule?.current_phase?.end_date
  const nextPhase = currentPhaseEnd
    ? schedule?.phases.find((phase) => phase.start_date >= currentPhaseEnd) ?? null
    : null
  let scheduledPlan: ProviderSubscriptionSnapshot["scheduledPlan"] = null
  let scheduleIssue: string | null = activeSchedule && !ownsSchedule ? "unmanaged_subscription_schedule" : null
  if (nextPhase) {
    if (nextPhase.items.length !== 1 || (nextPhase.items[0]?.quantity ?? 1) !== 1) {
      scheduleIssue = "unsupported_subscription_schedule"
    } else {
      const targetPrice = nextPhase.items[0]?.price
      const targetPriceId = typeof targetPrice === "string" ? targetPrice : targetPrice?.id
      const effectiveAt = unixSecondsToIso(nextPhase.start_date)
      if (!targetPriceId || !effectiveAt) scheduleIssue = "unsupported_subscription_schedule"
      else scheduledPlan = { priceId: targetPriceId, effectiveAt }
    }
  }

  return {
    id: subscription.id,
    status: collectionPaused && status.status === "active" ? "paused" : status.status,
    // Persist the normalized state so terminal provider-only values (such as
    // `incomplete_expired`) cannot keep checkout eligibility locked forever.
    providerStatus: collectionPaused && status.status === "active" ? "paused" : status.status,
    issueCode: scheduleIssue || (collectionPaused ? "payment_collection_paused" : status.issueCode),
    livemode: subscription.livemode,
    customerId,
    nextBilledAt: endsAt,
    currentBillingPeriod,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    cancelEffectiveAt,
    hasPendingUpdate: Boolean(subscription.pending_update),
    scheduleId: ownsSchedule ? activeSchedule?.id ?? null : null,
    scheduledPlan,
    collectionPaused,
    customData: {
      ...subscription.metadata,
      ...(ownsSchedule && activeSchedule?.metadata?.billing_mutation_id
        ? { billing_schedule_mutation_id: activeSchedule.metadata.billing_mutation_id }
        : {}),
      ...(ownsSchedule ? { billing_schedule_mutation_kind: "scheduled_plan_change" } : {}),
      ...(ownsSchedule && activeSchedule?.metadata?.billing_target_plan_key
        ? { billing_schedule_target_plan_key: activeSchedule.metadata.billing_target_plan_key }
        : {}),
      ...(ownsSchedule && activeSchedule?.metadata?.billing_target_interval
        ? { billing_schedule_target_interval: activeSchedule.metadata.billing_target_interval }
        : {}),
    },
    items,
  }
}

export function buildStripeCheckoutSessionParams(request: ProviderCheckoutRequest, environment: BillingProviderEnvironment): Stripe.Checkout.SessionCreateParams {
  validateCheckoutRequest(request)
  const metadata = {
    workspace_id: request.workspaceId,
    billing_mutation_id: request.mutationId,
    plan_key: request.planKey,
    billing_interval: request.interval,
    billing_environment: environment,
    billing_provider: "stripe",
  }
  return {
    mode: "subscription",
    line_items: [{ price: request.priceId, quantity: 1 }],
    ...(request.customerId ? { customer: request.customerId } : {}),
    ...(!request.customerId && request.customerEmail ? { customer_email: request.customerEmail } : {}),
    client_reference_id: request.workspaceId,
    success_url: request.successUrl,
    cancel_url: request.cancelUrl,
    integration_identifier: getStripeIntegrationIdentifier(request.mutationId),
    metadata,
    // Keep Sandbox Checkout on Stripe's direct payments flow until Product tax
    // classification is established; Live follows the account configuration.
    ...(environment === "sandbox" ? { managed_payments: { enabled: false } } : {}),
    subscription_data: {
      billing_mode: { type: "flexible" },
      metadata,
    },
  }
}

export function matchesPaidStripePeriod(
  invoice: Pick<Stripe.Invoice, "livemode" | "status" | "customer" | "parent">,
  lines: Stripe.InvoiceLineItem[],
  subscription: ProviderSubscriptionSnapshot,
) {
  const invoiceSubscription = invoice.parent?.subscription_details?.subscription
  const subscriptionId = typeof invoiceSubscription === "string" ? invoiceSubscription : invoiceSubscription?.id
  const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id
  if (invoice.status !== "paid" || invoice.livemode !== subscription.livemode ||
      subscriptionId !== subscription.id || !customerId || customerId !== subscription.customerId) return false
  const item = subscription.items[0]
  const period = subscription.currentBillingPeriod
  if (subscription.items.length !== 1 || !item?.priceId || !period) return false
  const start = Date.parse(period.startsAt)
  const end = Date.parse(period.endsAt)
  return Number.isFinite(start) && end > start && lines.some((line) => {
    const details = line.parent?.subscription_item_details
    const price = line.pricing?.price_details?.price
    const priceId = typeof price === "string" ? price : price?.id
    return details?.subscription_item === item.id && !details.proration && priceId === item.priceId &&
      line.period.start * 1000 === start && line.period.end * 1000 === end
  })
}

export function createStripeBillingAdapter(): StripeBillingAdapter {
  const config = getStripeBillingConfig()
  const stripe = getStripeClient(config)

  return {
    provider: "stripe",
    environment: config.environment,
    async createCheckoutSession(request: ProviderCheckoutRequest) {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const session = await stripe.checkout.sessions.create(buildStripeCheckoutSessionParams(request, config.environment), {
        idempotencyKey: `placedj_checkout_${request.mutationId}`,
      })
      const normalized = normalizeCheckoutSession(session)
      assertStripeMode(config, normalized.livemode)
      return normalized
    },
    async retrieveCheckoutSession(id: string) {
      await assertStripeAccountBinding(config)
      const session = await stripe.checkout.sessions.retrieve(id, { expand: ["subscription", "customer"] })
      const normalized = normalizeCheckoutSession(session)
      assertStripeMode(config, normalized.livemode)
      return normalized
    },
    async expireCheckoutSession(id: string) {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const session = await stripe.checkout.sessions.expire(id)
      const normalized = normalizeCheckoutSession(session)
      assertStripeMode(config, normalized.livemode)
      return normalized
    },
    async retrieveSubscription(id: string) {
      await assertStripeAccountBinding(config)
      const subscription = await stripe.subscriptions.retrieve(id, { expand: ["items.data.price", "schedule"] })
      const normalized = normalizeStripeSubscription(subscription)
      assertStripeMode(config, normalized.livemode)
      return normalized
    },
    async hasPaidRenewal(subscription) {
      await assertStripeAccountBinding(config)
      const invoices = await stripe.invoices.list({ subscription: subscription.id, status: "paid", limit: 10 })
      for (const invoice of invoices.data) {
        if (matchesPaidStripePeriod(invoice, invoice.lines.data, subscription)) return true
        if (invoice.lines.has_more && invoice.id) {
          const lines = await stripe.invoices.listLineItems(invoice.id, { limit: 100 })
          if (matchesPaidStripePeriod(invoice, lines.data, subscription)) return true
        }
      }
      return false
    },
    async createPortalSession(request: ProviderPortalRequest): Promise<ProviderPortalSession> {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      if (!request.customerId || !isSafeHttpsUrl(request.returnUrl)) throw new Error("A valid customer and secure return URL are required.")
      if (!config.portalConfigurationId) throw new Error("Stripe billing portal configuration is not configured.")
      const portal = await stripe.billingPortal.sessions.create({ customer: request.customerId, return_url: request.returnUrl, configuration: config.portalConfigurationId })
      return { url: portal.url }
    },
    async retrievePrice(id: string) {
      await assertStripeAccountBinding(config)
      const price = await stripe.prices.retrieve(id, { expand: ["product"] })
      assertStripeMode(config, price.livemode)
      const product = typeof price.product === "string" ? price.product : price.product?.id
      if (!product) throw new Error("Stripe Price is not linked to an active Product.")
      return {
        id: price.id,
        productId: product,
        amount: price.unit_amount,
        currency: price.currency.toUpperCase(),
        interval: price.recurring?.interval || null,
        intervalCount: price.recurring?.interval_count || null,
        livemode: price.livemode,
      }
    },
    async getCustomerPaymentMethod(customerId: string) {
      await assertStripeAccountBinding(config)
      const customer = await stripe.customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] })
      if ("deleted" in customer && customer.deleted) return null
      const method = customer.invoice_settings.default_payment_method
      const paymentMethod = typeof method === "string" ? await stripe.paymentMethods.retrieve(method) : method
      if (!paymentMethod) return null
      const card = paymentMethod.card
      return {
        type: paymentMethod.type,
        last4: card?.last4 || null,
        expiryMonth: card?.exp_month || null,
        expiryYear: card?.exp_year || null,
      }
    },
    async listInvoices(customerId: string, subscriptionId?: string | null) {
      await assertStripeAccountBinding(config)
      const invoices = await stripe.invoices.list({ customer: customerId, limit: 20 })
      return invoices.data.map(toStripeInvoiceSummary).filter((invoice) => !subscriptionId || invoice.subscriptionId === subscriptionId)
    },
    async retrieveInvoice(id: string, expectedCustomerId: string, expectedSubscriptionId?: string | null) {
      await assertStripeAccountBinding(config)
      const invoice = await stripe.invoices.retrieve(id)
      assertStripeMode(config, invoice.livemode)
      const summary = toStripeInvoiceSummary(invoice)
      if (summary.customerId !== expectedCustomerId) throw new Error("Invoice does not belong to the current Workspace customer.")
      if (expectedSubscriptionId && summary.subscriptionId !== expectedSubscriptionId) throw new Error("Invoice does not belong to the current Workspace subscription.")
      return summary
    },
    async previewSubscriptionChange(input) {
      await assertStripeAccountBinding(config)
      const invoice = await stripe.invoices.createPreview({
        customer: input.customerId,
        subscription: input.subscriptionId,
        subscription_details: {
          items: [{ id: input.itemId, price: input.priceId, quantity: 1 }],
          proration_behavior: "always_invoice",
          proration_date: input.prorationDate,
          ...(input.resetBillingCycle ? { billing_cycle_anchor: { type: "now" } } : {}),
        },
      })
      assertStripeMode(config, invoice.livemode)
      return {
        amountDue: invoice.amount_due,
        amount: invoice.total,
        creditToBalance: Math.max(0, -invoice.total),
        action: invoice.amount_due > 0 ? "charge" : invoice.total < 0 ? "credit" : "none",
        currency: invoice.currency.toUpperCase(),
        nextPaymentAttempt: unixSecondsToIso(invoice.next_payment_attempt),
      }
    },
    async updateSubscriptionPrice(input) {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const subscription = await stripe.subscriptions.update(input.subscriptionId, {
        items: [{ id: input.itemId, price: input.priceId, quantity: 1 }],
        proration_behavior: "always_invoice",
        proration_date: input.prorationDate,
        payment_behavior: "pending_if_incomplete",
        ...(input.resetBillingCycle ? { billing_cycle_anchor: "now" as unknown as Stripe.SubscriptionUpdateParams.BillingCycleAnchor } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      }, { idempotencyKey: input.idempotencyKey })
      assertStripeMode(config, subscription.livemode)
      return normalizeStripeSubscription(subscription)
    },
    async schedulePlanChange(input) {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId, { expand: ["schedule"] })
      assertStripeMode(config, subscription.livemode)
      let schedule = typeof subscription.schedule === "object" && subscription.schedule ? subscription.schedule : null
      if (!schedule && typeof subscription.schedule === "string") {
        schedule = await stripe.subscriptionSchedules.retrieve(subscription.schedule)
      }
      let createdForThisMutation = false
      if (!schedule) {
        // Stripe rejects metadata on schedule creation when from_subscription
        // is set. The following schedule update attaches our metadata together
        // with the new phase configuration.
        schedule = await stripe.subscriptionSchedules.create(
          buildStripeScheduleCreateParams(input.subscriptionId),
          { idempotencyKey: `${input.idempotencyKey}_create` },
        )
        createdForThisMutation = true
      }
      if (schedule.livemode !== (config.environment === "live")) throw new Error("Stripe schedule belongs to another environment.")
      if (!createdForThisMutation && !isCoreBillingSchedule(schedule)) throw new Error("The active Stripe schedule is not managed by SaaS Core and cannot be changed here.")
      const currentPhase = schedule.current_phase
      const current = currentPhase && schedule.phases.find((phase) => phase.start_date <= currentPhase.start_date && phase.end_date === currentPhase.end_date)
      if (!current || !current.items.length || current.items.length !== 1) throw new Error("Stripe schedule has an unsupported current phase.")
      const currentItem = current.items[0]
      const currentItemPriceId = typeof currentItem.price === "string" ? currentItem.price : currentItem.price.id
      if (currentItemPriceId !== input.currentPriceId) throw new Error("Stripe schedule current Price changed; refresh the billing preview.")
      const sharedPhase = {
        currency: current.currency,
        collection_method: current.collection_method || "charge_automatically",
        proration_behavior: "none" as const,
        ...(current.automatic_tax ? {
          automatic_tax: {
            enabled: current.automatic_tax.enabled,
            ...(current.automatic_tax.liability ? {
              liability: {
                type: current.automatic_tax.liability.type,
                ...(current.automatic_tax.liability.account ? {
                  account: typeof current.automatic_tax.liability.account === "string"
                    ? current.automatic_tax.liability.account
                    : current.automatic_tax.liability.account.id,
                } : {}),
              },
            } : {}),
          },
        } : {}),
        ...(current.default_tax_rates ? { default_tax_rates: current.default_tax_rates.map((rate) => typeof rate === "string" ? rate : rate.id) } : {}),
        ...(current.description ? { description: current.description } : {}),
        ...(current.discounts?.length ? {
          discounts: current.discounts.flatMap((discount) => {
            if (!discount.coupon) return []
            return [{ coupon: typeof discount.coupon === "string" ? discount.coupon : discount.coupon.id }]
          }),
        } : {}),
        ...(current.invoice_settings ? {
          invoice_settings: {
            ...(current.invoice_settings.account_tax_ids ? { account_tax_ids: current.invoice_settings.account_tax_ids.map((id) => typeof id === "string" ? id : id.id) } : {}),
            ...(current.invoice_settings.issuer ? {
              issuer: {
                type: current.invoice_settings.issuer.type,
                ...(current.invoice_settings.issuer.account ? {
                  account: typeof current.invoice_settings.issuer.account === "string"
                    ? current.invoice_settings.issuer.account
                    : current.invoice_settings.issuer.account.id,
                } : {}),
              },
            } : {}),
          },
        } : {}),
        ...(current.on_behalf_of ? { on_behalf_of: typeof current.on_behalf_of === "string" ? current.on_behalf_of : current.on_behalf_of.id } : {}),
        ...(current.transfer_data ? {
          transfer_data: {
            destination: typeof current.transfer_data.destination === "string"
              ? current.transfer_data.destination
              : current.transfer_data.destination.id,
            ...(current.transfer_data.amount_percent !== null && current.transfer_data.amount_percent !== undefined
              ? { amount_percent: current.transfer_data.amount_percent }
              : {}),
          },
        } : {}),
      }
      const firstPhase = {
        ...sharedPhase,
        start_date: currentPhase.start_date,
        end_date: input.periodEnd,
        items: [{ price: input.currentPriceId, quantity: currentItem.quantity ?? 1 }],
      }
      const futurePhase = {
        ...sharedPhase,
        start_date: input.periodEnd,
        duration: buildStripeSchedulePhaseDuration(input.targetInterval, input.intervalCount),
        items: [{ price: input.targetPriceId, quantity: 1 }],
      }
      const updated = await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: "release",
        metadata: {
          ...(schedule.metadata || {}),
          billing_provider: "stripe",
          billing_integration: "saas-core",
          billing_mutation_id: input.mutationId,
          billing_mutation_kind: "scheduled_plan_change",
          billing_target_plan_key: input.targetPlanKey,
          billing_target_interval: input.targetInterval,
        },
        phases: [firstPhase, futurePhase],
      }, { idempotencyKey: `${input.idempotencyKey}_update` })
      assertStripeMode(config, updated.livemode)
      return { scheduleId: updated.id, effectiveAt: unixSecondsToIso(input.periodEnd) || new Date(input.periodEnd * 1000).toISOString() }
    },
    async releaseSchedule(subscriptionId, scheduleId, idempotencyKey, mutationKind = "undo_plan_change") {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const schedule = await stripe.subscriptionSchedules.retrieve(scheduleId)
      const attachedSubscriptionId = typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription?.id
      if (schedule.livemode !== (config.environment === "live") || attachedSubscriptionId !== subscriptionId || schedule.status !== "active" || !isCoreBillingSchedule(schedule)) {
        throw new Error("The scheduled billing change is no longer active or is not managed by SaaS Core.")
      }
      await stripe.subscriptions.update(subscriptionId, {
        metadata: {
          billing_mutation_id: idempotencyKey,
          billing_mutation_kind: mutationKind,
          billing_provider: "stripe",
        },
      }, { idempotencyKey: getStripeMutationIdempotencyKey(idempotencyKey, "mutation_marker") })
      await stripe.subscriptionSchedules.release(scheduleId, {}, { idempotencyKey: getStripeMutationIdempotencyKey(idempotencyKey, "schedule_release") })
    },
    async scheduleCancellation(subscriptionId, idempotencyKey) {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
        metadata: { billing_mutation_id: idempotencyKey, billing_mutation_kind: "cancel", billing_provider: "stripe" },
      }, { idempotencyKey: getStripeMutationIdempotencyKey(idempotencyKey, "schedule_cancellation") })
      assertStripeMode(config, subscription.livemode)
      return normalizeStripeSubscription(subscription)
    },
    async undoScheduledCancellation(subscriptionId, idempotencyKey) {
      assertBillingMutationsEnabled()
      assertStripeBillingReady()
      await assertStripeAccountBinding(config)
      const subscription = await stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
        metadata: { billing_mutation_id: idempotencyKey, billing_mutation_kind: "resume", billing_provider: "stripe" },
      }, { idempotencyKey })
      assertStripeMode(config, subscription.livemode)
      return normalizeStripeSubscription(subscription)
    },
    async verifyWebhook(rawBody: string, signature: string) {
      if (!rawBody) throw new Error("Webhook body cannot be empty.")
      if (!signature) throw new Error("Stripe webhook signature is missing.")
      const event = getStripeClient(config).webhooks.constructEvent(rawBody, signature, config.webhookSecret)
      assertStripeMode(config, event.livemode)
      if (event.account && event.account !== config.expectedAccountId) {
        throw new Error("Stripe webhook belongs to an unexpected account.")
      }
      return event
    },
  }
}

function assertStripeMode(config: StripeBillingConfig, livemode: boolean) {
  if (livemode !== (config.environment === "live")) {
    throw new Error("Stripe object mode does not match STRIPE_ENVIRONMENT.")
  }
}

function validateCheckoutRequest(request: ProviderCheckoutRequest) {
  if (!request.mutationId.trim() || !request.workspaceId.trim() || !request.planKey.trim() || !request.priceId.trim()) {
    throw new Error("Checkout is missing its server-authorized billing context.")
  }
  if (!isSafeHttpsUrl(request.successUrl) || !isSafeHttpsUrl(request.cancelUrl)) {
    throw new Error("Checkout return URLs must use HTTPS.")
  }
}

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname === "127.0.0.1" || url.hostname === "[::1]"))
  } catch {
    return false
  }
}

/** Check the connected key still addresses the configured account and mode. */
export async function assertStripeAccountBinding(config: StripeBillingConfig = getStripeBillingConfig()) {
  const fingerprint = createHash("sha256").update(config.secretKey).digest("hex")
  const key = `${config.environment}:${config.expectedAccountId}:${fingerprint}`
  if (verifiedStripeAccountBindings.has(key)) return { accountId: config.expectedAccountId, environment: config.environment }
  const stripe = getStripeClient(config)
  const account = await stripe.accounts.retrieve(null)
  if (account.id !== config.expectedAccountId) {
    throw new Error("Configured Stripe credentials do not match STRIPE_ACCOUNT_ID.")
  }
  verifiedStripeAccountBindings.add(key)
  return { accountId: account.id, environment: config.environment }
}

function toStripeInvoiceSummary(invoice: Stripe.Invoice): StripeInvoiceSummary {
  const raw = invoice as unknown as Record<string, unknown>
  const parent = raw.parent && typeof raw.parent === "object" ? raw.parent as Record<string, unknown> : {}
  const subscriptionDetails = parent.subscription_details && typeof parent.subscription_details === "object" ? parent.subscription_details as Record<string, unknown> : {}
  const subscription = raw.subscription ?? subscriptionDetails.subscription
  const subscriptionId = typeof subscription === "string"
    ? subscription
    : subscription && typeof subscription === "object" && "id" in subscription && typeof subscription.id === "string"
      ? subscription.id
      : null
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    currency: invoice.currency.toUpperCase(),
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    createdAt: unixSecondsToIso(invoice.created),
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    pdfUrl: invoice.invoice_pdf ?? null,
    customerId: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null,
    subscriptionId,
  }
}
