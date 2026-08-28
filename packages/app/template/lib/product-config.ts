export type ProductPlanDefinition = {
  key: string
  name: string
  description?: string
  prices?: Readonly<Record<string, { amount: number | null; currency: string; providerPriceId?: string }>>
  features?: Readonly<Record<string, boolean>>
  limits?: Readonly<Record<string, number | null>>
  metadata?: Readonly<Record<string, unknown>>
}

export type ProductUsageMetricDefinition = {
  key: string
  name: string
  unit?: string
}

export type ProductCatalog = {
  defaultPlanKey?: string
  plans: readonly ProductPlanDefinition[]
  usageMetrics?: readonly ProductUsageMetricDefinition[]
}

export type ProductConfig = {
  name: string
  slug: string
  logoPath: string
  iconPath: string
  themeColor: string
  description: string
  capabilities: Readonly<Record<string, boolean>>
  /** Product-owned commercial catalog. Core only evaluates its stable keys. */
  catalog: ProductCatalog
}

/**
 * The only product identity the Core runtime owns. Products can replace this
 * module or provide these values at their app boundary without changing Core
 * authorization, tenancy, or interaction code.
 */
export const PRODUCT_CONFIG: ProductConfig = {
  name: "SaaS Core",
  slug: "saas-core",
  logoPath: "/product-mark.svg",
  iconPath: "/product-mark.svg",
  themeColor: "#7c3aed",
  description: "A production-ready workspace foundation for focused products.",
  capabilities: {
    billing: true,
    domains: true,
    platformControl: true,
    pushNotifications: true,
    pwa: true,
  },
  catalog: {
    plans: [],
    usageMetrics: [],
  },
}
