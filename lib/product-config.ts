import productCatalog from "@/product.catalog.json"
import type { ProductBillingConfig } from "@sapienx/saas-core"
import type { PlatformRole } from "./platform-types"

export type ProductPlanDefinition = {
  key: string
  name: string
  description?: string
  active?: boolean
  recommended?: boolean
  sort_order?: number
  sortOrder?: number
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
  billingPolicy?: ProductBillingConfig
}

export type ProductOnboardingConfig = {
  /** Optional product-owned setup route after Core onboarding is complete. */
  productSetupPath?: string | null
  /** Manual Workspace creation is the compatibility default. */
  workspaceProvisioning?: "manual" | "deferred"
}

export type ProductAuthConfig = {
  /** Optional HTTPS media surface rendered behind Core auth forms. */
  backgroundUrl?: string | null
}

export type ProductShellNavigationItem = {
  key: string
  label: string
  href: string
  icon?: string
  match?: "exact" | "prefix"
  workspaceRoles?: readonly ("owner" | "admin" | "manager" | "staff" | "readonly")[]
  requiredFeature?: string
}

export type ProductShellConfig = {
  homePath?: string | null
  homeLabel?: string | null
  navigation?: readonly ProductShellNavigationItem[]
}

export type ProductPlatformNavigationItem = {
  key: string
  label: string
  href: string
  icon?: string
  match?: "exact" | "prefix"
  platformRoles?: readonly PlatformRole[]
  /** Optional product-owned paths kept as compatibility aliases for this surface. */
  legacyPaths?: readonly string[]
}

export type ProductConfig = {
  name: string
  slug: string
  logoPath: string
  iconPath: string
  /** Optional same-origin 192px app icon; iconPath remains the 512px fallback. */
  iconPath192?: string
  themeColor: string
  description: string
  capabilities: Readonly<Record<string, boolean>>
  /** Optional platform-role allowlists for capabilities that are operator-only. */
  capabilityPlatformRoles?: Readonly<Record<string, readonly string[]>>
  onboarding?: ProductOnboardingConfig
  auth?: ProductAuthConfig
  shell?: ProductShellConfig
  /** Product-owned platform surfaces rendered inside the Core management shell. */
  platformNavigation?: readonly ProductPlatformNavigationItem[]
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
  platformNavigation: [],
  catalog: productCatalog as ProductCatalog,
}

export function getProductOnboardingPath() {
  const configured = PRODUCT_CONFIG.onboarding?.productSetupPath?.trim()
  if (!configured || !configured.startsWith("/") || configured.startsWith("//")) return "/app"
  return configured
}

export function getWorkspaceProvisioningMode() {
  return PRODUCT_CONFIG.onboarding?.workspaceProvisioning === "deferred" ? "deferred" as const : "manual" as const
}

export function isDeferredWorkspaceProvisioning() {
  return getWorkspaceProvisioningMode() === "deferred"
}

export function isProductCapabilityEnabled(
  capability: string,
  platformRole?: string | null,
  config: Pick<ProductConfig, "capabilities" | "capabilityPlatformRoles"> = PRODUCT_CONFIG,
) {
  if (config.capabilities[capability] === false) return false
  const allowedRoles = config.capabilityPlatformRoles?.[capability]
  return !allowedRoles || Boolean(platformRole && allowedRoles.includes(platformRole))
}
