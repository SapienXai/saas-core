import type { ProductCatalog, ProductIdentity } from "@sapienx/saas-core"

export type ProductCapabilityConfig = Readonly<Record<string, boolean>>

export type SaaSCoreProductConfig = {
  identity: ProductIdentity
  capabilities: ProductCapabilityConfig
  catalog: ProductCatalog
  navigation?: readonly { label: string; href: string; icon?: string }[]
}

export function defineProductConfig(config: SaaSCoreProductConfig): SaaSCoreProductConfig {
  if (!config.identity.name.trim()) throw new Error("Product identity name is required.")
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.identity.slug)) throw new Error("Product identity slug must be kebab-case.")
  const planKeys = config.catalog.plans.map((plan) => plan.key)
  if (new Set(planKeys).size !== planKeys.length) throw new Error("Product plan keys must be unique.")
  if (config.catalog.defaultPlanKey && !planKeys.includes(config.catalog.defaultPlanKey)) throw new Error("The default plan key must exist in the product catalog.")
  return config
}

export function validateProductCatalog(catalog: ProductCatalog) {
  return defineProductConfig({ identity: { name: "Catalog validation", slug: "catalog-validation" }, capabilities: {}, catalog }).catalog
}

export type { ProductCatalog, ProductIdentity }
