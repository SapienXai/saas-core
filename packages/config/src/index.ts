import {
  validateBillingPolicy,
  validateBillingPresentation,
  validateProductCatalog as validateCoreProductCatalog,
  type ProductAuthConfig,
  type ProductBillingConfig,
  type ProductBillingPolicy,
  type ProductBillingPresentation,
  type ProductCatalog,
  type ProductIdentity,
  type ProductOnboarding,
  type ProductPlatformNavigationItem,
  type ProductShellConfig,
  type ProductShellNavigationItem,
} from "@sapienx/saas-core"

export type ProductCapabilityConfig = Readonly<Record<string, boolean>>
export type ProductOnboardingConfig = ProductOnboarding

export type SaaSCoreProductConfig = {
  identity: ProductIdentity
  capabilities: ProductCapabilityConfig
  catalog: ProductCatalog
  /** Optional additive billing policy; omitted fields retain Core defaults. */
  billing?: ProductBillingConfig
  billingPolicy?: ProductBillingConfig
  billingPresentation?: ProductBillingPresentation
  onboarding?: ProductOnboardingConfig
  auth?: ProductAuthConfig
  shell?: ProductShellConfig
  platformNavigation?: readonly ProductPlatformNavigationItem[]
  navigation?: readonly { label: string; href: string; icon?: string }[]
}

function validatePresentationReferences(catalog: ProductCatalog, presentation: ProductBillingPresentation, path: string) {
  const planKeys = new Set(catalog.plans.map((plan) => plan.key))
  if (presentation.planOrder && (presentation.planOrder.length !== planKeys.size || presentation.planOrder.some((key) => !planKeys.has(key)) || new Set(presentation.planOrder).size !== presentation.planOrder.length)) throw new Error(`${path}.planOrder must contain every catalog plan exactly once.`)
  const featureKeys = new Set(catalog.plans.flatMap((plan) => Object.keys(plan.features || {})))
  const limitKeys = new Set(catalog.plans.flatMap((plan) => Object.keys(plan.limits || {})))
  for (const key of presentation.featureKeys || []) if (!featureKeys.has(key)) throw new Error(`${path}.featureKeys references an undefined feature key: ${key}.`)
  for (const key of presentation.limitKeys || []) if (!limitKeys.has(key)) throw new Error(`${path}.limitKeys references an undefined limit key: ${key}.`)
  for (const row of [...(presentation.comparison || []), ...(presentation.comparisonRows || [])]) {
    if (row.kind === "feature" && row.featureKey && !featureKeys.has(row.featureKey)) throw new Error(`${path}.comparison references an undefined feature key: ${row.featureKey}.`)
    if (row.kind === "limit" && row.limitKey && !limitKeys.has(row.limitKey)) throw new Error(`${path}.comparison references an undefined limit key: ${row.limitKey}.`)
  }
  for (const key of Object.keys(presentation.plans || {})) if (!planKeys.has(key)) throw new Error(`${path}.plans references an undefined plan key: ${key}.`)
}

export function defineProductConfig(config: SaaSCoreProductConfig): SaaSCoreProductConfig {
  if (!config || typeof config !== "object") throw new Error("Product config must be an object.")
  if (!config.identity || typeof config.identity !== "object") throw new Error("Product identity is required.")
  if (typeof config.identity.name !== "string" || !config.identity.name.trim()) throw new Error("Product identity name is required.")
  if (typeof config.identity.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.identity.slug)) throw new Error("Product identity slug must be kebab-case.")
  if (!config.capabilities || typeof config.capabilities !== "object" || Array.isArray(config.capabilities)) throw new Error("Product capabilities must be an object.")
  for (const [key, enabled] of Object.entries(config.capabilities)) if (typeof enabled !== "boolean") throw new Error(`Product capability ${key} must be a boolean.`)
  validateProductCatalog(config.catalog)
  for (const [path, policy] of [["billing", config.billing], ["billingPolicy", config.billingPolicy]] as const) {
    if (policy === undefined) continue
    validateBillingPolicy(policy, path)
    if (policy.defaultPlanKey !== undefined && policy.defaultPlanKey !== config.catalog.defaultPlanKey) throw new Error(`${path}.defaultPlanKey must match catalog.defaultPlanKey.`)
    if (policy.fallbackPlanKey !== undefined && !config.catalog.plans.some((plan) => plan.key === policy.fallbackPlanKey)) throw new Error(`${path}.fallbackPlanKey must identify an existing plan.`)
    if (policy.defaultInterval !== undefined && policy.supportedIntervals !== undefined && !policy.supportedIntervals.includes(policy.defaultInterval)) throw new Error(`${path}.defaultInterval must be listed in supportedIntervals.`)
    if (policy.presentation !== undefined) {
      validateBillingPresentation(policy.presentation, `${path}.presentation`)
      validatePresentationReferences(config.catalog, policy.presentation, `${path}.presentation`)
    }
  }
  if (config.billingPresentation !== undefined) {
    validateBillingPresentation(config.billingPresentation, "billingPresentation")
    validatePresentationReferences(config.catalog, config.billingPresentation, "billingPresentation")
  }
  if (config.onboarding?.productSetupPath && (!config.onboarding.productSetupPath.startsWith("/") || config.onboarding.productSetupPath.startsWith("//"))) throw new Error("Product onboarding path must be an internal path.")
  const workspaceProvisioning = config.onboarding?.workspaceProvisioning ?? "manual"
  if (workspaceProvisioning !== "manual" && workspaceProvisioning !== "deferred") throw new Error("Workspace provisioning must be manual or deferred.")
  if (workspaceProvisioning === "deferred" && !config.onboarding?.productSetupPath?.trim()) throw new Error("Deferred Workspace provisioning requires a product onboarding path.")
  return config
}

export function validateProductCatalog(catalog: ProductCatalog) {
  return validateCoreProductCatalog(catalog)
}

export type { ProductAuthConfig, ProductBillingConfig, ProductBillingPolicy, ProductBillingPresentation, ProductCatalog, ProductIdentity, ProductPlatformNavigationItem, ProductShellConfig, ProductShellNavigationItem }
