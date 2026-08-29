import type { ProductAuthConfig, ProductCatalog, ProductIdentity, ProductOnboarding, ProductShellConfig, ProductShellNavigationItem } from "@sapienx/saas-core"

export type ProductCapabilityConfig = Readonly<Record<string, boolean>>
export type ProductOnboardingConfig = ProductOnboarding

export type SaaSCoreProductConfig = {
  identity: ProductIdentity
  capabilities: ProductCapabilityConfig
  catalog: ProductCatalog
  onboarding?: ProductOnboardingConfig
  auth?: ProductAuthConfig
  shell?: ProductShellConfig
  navigation?: readonly { label: string; href: string; icon?: string }[]
}

export function defineProductConfig(config: SaaSCoreProductConfig): SaaSCoreProductConfig {
  if (!config.identity.name.trim()) throw new Error("Product identity name is required.")
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.identity.slug)) throw new Error("Product identity slug must be kebab-case.")
  const planKeys = config.catalog.plans.map((plan) => plan.key)
  if (new Set(planKeys).size !== planKeys.length) throw new Error("Product plan keys must be unique.")
  if (!config.catalog.defaultPlanKey || !planKeys.includes(config.catalog.defaultPlanKey)) throw new Error("The product catalog must define an existing default plan key.")
  const defaultPlan = config.catalog.plans.find((plan) => plan.key === config.catalog.defaultPlanKey)
  if (!defaultPlan?.limits || !Object.prototype.hasOwnProperty.call(defaultPlan.limits, "core.workspaces")) throw new Error("The default plan must explicitly define limits.core.workspaces; use null only for intentional unlimited workspaces.")
  if (config.onboarding?.productSetupPath && (!config.onboarding.productSetupPath.startsWith("/") || config.onboarding.productSetupPath.startsWith("//"))) throw new Error("Product onboarding path must be an internal path.")
  return config
}

export function validateProductCatalog(catalog: ProductCatalog) {
  return defineProductConfig({ identity: { name: "Catalog validation", slug: "catalog-validation" }, capabilities: {}, catalog }).catalog
}

export type { ProductAuthConfig, ProductCatalog, ProductIdentity, ProductShellConfig, ProductShellNavigationItem }
