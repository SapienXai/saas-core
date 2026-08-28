import productCatalog from "@/product.catalog.json"

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
  defaultPlanKey: string
  plans: readonly ProductPlanDefinition[]
  usageMetrics?: readonly ProductUsageMetricDefinition[]
}

export type ProductOnboardingConfig = {
  /** Optional product-owned setup route after Core onboarding is complete. */
  productSetupPath?: string | null
}

export type ProductConfig = {
  name: string
  slug: string
  logoPath: string
  iconPath: string
  themeColor: string
  description: string
  capabilities: Readonly<Record<string, boolean>>
  onboarding?: ProductOnboardingConfig
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
  description: "A focused place for your team to get work done.",
  capabilities: {
    billing: true,
    domains: true,
    platformControl: true,
    pushNotifications: true,
    pwa: true,
  },
  onboarding: { productSetupPath: "/app" },
  catalog: productCatalog as ProductCatalog,
}

export function getProductOnboardingPath() {
  const configured = PRODUCT_CONFIG.onboarding?.productSetupPath?.trim()
  if (!configured || !configured.startsWith("/") || configured.startsWith("//")) return "/app"
  return configured
}
