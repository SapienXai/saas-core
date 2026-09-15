import type { SupportedLanguage } from "@/i18n/config"
import { formatNumber } from "@/i18n/format"

export type BillingDisplayInterval = "month" | "year"

export type CurrentSubscriptionPrice = {
  amount: number | null
  currency: string | null
  interval: BillingDisplayInterval
  source: "provider" | "catalog" | "unavailable"
}

type PriceInput = {
  providerBacked?: boolean
  billingInterval?: string | null
  billingCurrency?: string | null
  currentProviderPriceAmount?: string | null
  pricing?: Record<string, { amount: number | null; currency: string } | undefined>
}

function isBillingDisplayInterval(value: unknown): value is BillingDisplayInterval {
  return value === "month" || value === "year"
}

function currencyCode(value: unknown) {
  return typeof value === "string" && /^[A-Z]{3}$/.test(value) ? value : null
}

function fractionDigits(currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    return null
  }
}

/** Resolve the price for the subscription that is active now, not the browse toggle or a pending target. */
export function resolveCurrentSubscriptionPrice(input: PriceInput): CurrentSubscriptionPrice | null {
  const pricing = input.pricing || {}
  const interval = isBillingDisplayInterval(input.billingInterval)
    ? input.billingInterval
    : Object.prototype.hasOwnProperty.call(pricing, "month")
      ? "month"
      : Object.prototype.hasOwnProperty.call(pricing, "year")
        ? "year"
        : null
  if (!interval) return null

  const providerCurrency = currencyCode(input.billingCurrency)
  const providerAmount = input.currentProviderPriceAmount == null ? Number.NaN : Number(input.currentProviderPriceAmount)
  const providerDigits = providerCurrency ? fractionDigits(providerCurrency) : null
  if (providerCurrency && providerDigits !== null && Number.isSafeInteger(providerAmount) && providerAmount >= 0) {
    return { amount: providerAmount / (10 ** providerDigits), currency: providerCurrency, interval, source: "provider" }
  }

  if (input.providerBacked) return { amount: null, currency: providerCurrency, interval, source: "unavailable" }

  const catalogPrice = pricing[interval]
  const catalogCurrency = currencyCode(catalogPrice?.currency)
  if (catalogPrice && catalogCurrency && typeof catalogPrice.amount === "number" && Number.isFinite(catalogPrice.amount) && catalogPrice.amount >= 0) {
    return { amount: catalogPrice.amount, currency: catalogCurrency, interval, source: "catalog" }
  }
  return null
}

export function formatCurrentSubscriptionPrice(price: CurrentSubscriptionPrice | null, language: SupportedLanguage) {
  if (!price || price.source === "unavailable" || price.amount === null || !price.currency) return null
  const digits = fractionDigits(price.currency)
  return formatNumber(price.amount, language, {
    style: "currency",
    currency: price.currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: digits ?? 2,
  })
}
