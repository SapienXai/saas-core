// Shared by the server adapter and the standalone Stripe reconciliation command.
/** @typedef {Pick<import("./provider").ProviderSubscriptionSnapshot, "id" | "customerId" | "livemode" | "currentBillingPeriod" | "items">} StripePeriodSubscription */

/**
 * @param {Pick<import("stripe").Stripe.Invoice, "livemode" | "status" | "customer" | "parent">} invoice
 * @param {import("stripe").Stripe.InvoiceLineItem[]} lines
 * @param {StripePeriodSubscription} subscription
 */
export function matchesPaidStripePeriod(invoice, lines, subscription) {
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

/**
 * @param {import("stripe").Stripe} stripe
 * @param {StripePeriodSubscription} subscription
 */
export async function hasMatchingPaidStripePeriod(stripe, subscription) {
  const invoices = await stripe.invoices.list({ subscription: subscription.id, status: "paid", limit: 10 })
  for (const invoice of invoices.data) {
    if (matchesPaidStripePeriod(invoice, invoice.lines.data, subscription)) return true
    if (invoice.lines.has_more && invoice.id) {
      const lines = await stripe.invoices.listLineItems(invoice.id, { limit: 100 })
      if (matchesPaidStripePeriod(invoice, lines.data, subscription)) return true
    }
  }
  return false
}
