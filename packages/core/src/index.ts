export const CORE_VERSION = "2.0.0"
export const CORE_SCHEMA_VERSION = "2.0"

export type CoreFeatureKey = string
export type CoreLimitKey = string
export type CoreUsageMetricKey = string

export type CorePrice = {
  amount: number | null
  currency: string
  providerPriceId?: string
}

export type ProductPlan = {
  key: string
  name: string
  description?: string
  prices?: Readonly<Record<string, CorePrice>>
  features?: Readonly<Record<CoreFeatureKey, boolean>>
  limits?: Readonly<Record<CoreLimitKey, number | null>>
  metadata?: Readonly<Record<string, unknown>>
}

export type ProductUsageMetric = {
  key: CoreUsageMetricKey
  name: string
  unit?: string
}

export type ProductCatalog = {
  defaultPlanKey: string
  plans: readonly ProductPlan[]
  usageMetrics?: readonly ProductUsageMetric[]
}

export type ProductIdentity = {
  name: string
  slug: string
  logoPath?: string
  iconPath?: string
  themeColor?: string
  description?: string
}

export type ProductOnboarding = {
  productSetupPath?: string | null
  /** Keep manual Workspace creation as the default; deferred is an explicit product-first handoff. */
  workspaceProvisioning?: "manual" | "deferred"
}

export type ProductAuthConfig = {
  /** Optional HTTPS media surface rendered behind Core auth forms. */
  backgroundUrl?: string | null
}

export type CoreWorkspaceRole = "owner" | "admin" | "manager" | "staff" | "readonly"

export type ProductShellNavigationItem = {
  key: string
  label: string
  href: string
  icon?: string
  match?: "exact" | "prefix"
  workspaceRoles?: readonly CoreWorkspaceRole[]
  requiredFeature?: string
}

export type ProductShellConfig = {
  homePath?: string | null
  homeLabel?: string | null
  navigation?: readonly ProductShellNavigationItem[]
}

export type ProductConfigContract = {
  identity: ProductIdentity
  catalog: ProductCatalog
  onboarding?: ProductOnboarding
  auth?: ProductAuthConfig
  shell?: ProductShellConfig
}

export type CoreManifest = {
  coreVersion: string
  schemaVersion: string
  packageVersions: Readonly<Record<string, string>>
  managedFiles: Readonly<Record<string, ManagedFile>>
  productOwnedPaths: readonly string[]
  templateVersion: string
  generatedAt: string
}

export type ManagedFile = {
  hash: string
  ownership: "managed" | "mergeable"
}

export type Ownership = "core-managed" | "package-owned" | "product-owned"

export type CompatibilityResult = {
  status: "compatible" | "warning" | "incompatible"
  detail: string
}

export function defineProductConfig<T extends ProductConfigContract>(config: T): T {
  if (!config.identity.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.identity.slug)) throw new Error("Product slug must be kebab-case.")
  if (!config.identity.name.trim()) throw new Error("Product name is required.")
  const keys = new Set<string>()
  for (const plan of config.catalog.plans) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(plan.key) || keys.has(plan.key)) throw new Error(`Invalid or duplicate product plan key: ${plan.key}`)
    keys.add(plan.key)
  }
  if (!config.catalog.defaultPlanKey || !keys.has(config.catalog.defaultPlanKey)) throw new Error("The product catalog must define an existing default plan key.")
  const defaultPlan = config.catalog.plans.find((plan) => plan.key === config.catalog.defaultPlanKey)
  if (!defaultPlan?.limits || !Object.prototype.hasOwnProperty.call(defaultPlan.limits, "core.workspaces")) throw new Error("The default plan must explicitly define limits.core.workspaces; use null only for intentional unlimited workspaces.")
  const productSetupPath = config.onboarding?.productSetupPath
  if (productSetupPath && (!productSetupPath.startsWith("/") || productSetupPath.startsWith("//"))) throw new Error("Product onboarding path must be an internal path.")
  const workspaceProvisioning = config.onboarding?.workspaceProvisioning ?? "manual"
  if (workspaceProvisioning !== "manual" && workspaceProvisioning !== "deferred") throw new Error("Workspace provisioning must be manual or deferred.")
  if (workspaceProvisioning === "deferred" && !productSetupPath?.trim()) throw new Error("Deferred Workspace provisioning requires a product onboarding path.")
  return config
}

export function evaluateCompatibility(input: { packageVersions?: Record<string, string>; manifestVersion?: string; schemaVersion?: string }): CompatibilityResult {
  if (input.schemaVersion && input.schemaVersion !== CORE_SCHEMA_VERSION) return { status: "incompatible", detail: `Core schema ${input.schemaVersion} is not compatible with ${CORE_SCHEMA_VERSION}.` }
  if (input.manifestVersion && input.manifestVersion.split(".")[0] !== CORE_VERSION.split(".")[0]) return { status: "incompatible", detail: `Core major version ${input.manifestVersion} is not compatible with ${CORE_VERSION}.` }
  const versions = Object.values(input.packageVersions || {})
  if (versions.some((version) => version.startsWith("file:") || version.startsWith("link:"))) return { status: "incompatible", detail: "Core packages must resolve from a portable versioned dependency." }
  if (versions.some((version) => !/^\^?\d+\.\d+\.\d+/.test(version))) return { status: "warning", detail: "One or more Core package versions are not pinned to a semver release." }
  return { status: "compatible", detail: `Core ${CORE_VERSION} / schema ${CORE_SCHEMA_VERSION}` }
}
