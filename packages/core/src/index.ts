export const CORE_VERSION = "2.6.0"
export const CORE_SCHEMA_VERSION = "2.0"

export * from "./billing.js"
export * from "./entitlements.js"
export type {
  CoreDomainType,
  CoreDomainStatus,
  CorePublicSite,
  CoreDomain,
  CoreHostResolution,
  CoreListDomainsInput,
  CorePlatformSubdomainInput,
  CoreDomainMutationResult,
  CoreDomainService,
} from "./domains.js"
// Keep the runtime validator explicit for bundlers that do not preserve
// value re-exports from a type-heavy contract module.
export { isCoreProductKey } from "./domains.js"

import {
  isBillingInterval,
  resolvePlanOrder,
  validateBillingPolicy,
  validateBillingPresentation,
  type ProductBillingConfig,
  type ProductBillingPresentation,
} from "./billing.js"

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
  active?: boolean
  recommended?: boolean
  sort_order?: number
  sortOrder?: number
  prices?: Readonly<Record<string, CorePrice>>
  features?: Readonly<Record<CoreFeatureKey, boolean>>
  limits?: Readonly<Record<CoreLimitKey, number | null>>
  metadata?: Readonly<Record<string, unknown>>
}

/**
 * A plan definition is deliberately the same contract used by ProductCatalog.
 * The key is the stable identifier; consumers own its meaning and display
 * copy. Core only validates and carries the definition through its lifecycle.
 */
export type PlanDefinition = ProductPlan

export type ProductPlanChangeScope = "none" | "presentation" | "commercial" | "identity"

export type ProductUsageMetric = {
  key: CoreUsageMetricKey
  name: string
  unit?: string
}

export type ProductCatalog = {
  defaultPlanKey: string
  plans: readonly ProductPlan[]
  usageMetrics?: readonly ProductUsageMetric[]
  /** Optional additive policy; omitted catalogs retain the existing defaults. */
  billing?: ProductBillingConfig
  billingPolicy?: ProductBillingConfig
  presentation?: ProductBillingPresentation
  billingPresentation?: ProductBillingPresentation
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

export type CorePlatformRole = "platform_owner" | "platform_admin" | "support" | "auditor" | "billing_admin"

export type ProductPlatformNavigationItem = {
  key: string
  label: string
  href: string
  icon?: string
  match?: "exact" | "prefix"
  platformRoles?: readonly CorePlatformRole[]
  /** Optional product-owned paths kept as compatibility aliases for this surface. */
  legacyPaths?: readonly string[]
}

export type ProductConfigContract = {
  identity: ProductIdentity
  catalog: ProductCatalog
  billing?: ProductBillingConfig
  billingPolicy?: ProductBillingConfig
  billingPresentation?: ProductBillingPresentation
  onboarding?: ProductOnboarding
  auth?: ProductAuthConfig
  shell?: ProductShellConfig
  /** Product-owned platform surfaces rendered inside the shared management shell. */
  platformNavigation?: readonly ProductPlatformNavigationItem[]
}

/** A JSON Schema value accepted as the input contract for an agent tool. */
export type JsonSchema = {
  readonly $schema?: string
  readonly type?: string | readonly string[]
  readonly properties?: Readonly<Record<string, JsonSchema>>
  readonly required?: readonly string[]
  readonly items?: JsonSchema | readonly JsonSchema[]
  readonly [keyword: string]: unknown
}

export type AgentToolKind = "read" | "mutation"

export type AgentToolExecutionContext = {
  signal: AbortSignal
}

export type AgentToolDefinition<Input = unknown, Output = unknown> = {
  name: string
  title?: string
  description: string
  inputSchema: JsonSchema
  kind: AgentToolKind
  returnsUntrustedContent: boolean
  requiresConfirmation: boolean
  /** Static product copy only; never derived from tool input. */
  confirmationMessage?: string
  execute(input: Input, context: AgentToolExecutionContext): Promise<Output>
}

export type AgentToolCancellationCode = "confirmation_rejected" | "confirmation_unavailable" | "cancelled"

export type AgentToolCancellation = {
  ok: false
  error: {
    code: AgentToolCancellationCode
    message: string
    retryable: boolean
  }
}

export type AgentToolExecutionFailure = {
  ok: false
  error: {
    code: "execution_failed"
    message: "The tool could not be completed."
  }
}

export type AgentToolResult<Output> = { ok: true; data: Output } | AgentToolExecutionFailure | AgentToolCancellation

export type AgentSurfaceEvent =
  | { type: "tool_registered"; toolName: string }
  | { type: "tool_registration_failed"; toolName: string; errorCode: "duplicate_name" | "registration_failed" }
  | { type: "tool_execution_started"; toolName: string }
  | { type: "tool_execution_succeeded"; toolName: string; durationMs: number }
  | { type: "tool_execution_failed"; toolName: string; durationMs: number; errorCode: "execution_failed" }
  | { type: "tool_cancelled"; toolName: string; durationMs?: number }
  | { type: "tool_confirmation_rejected"; toolName: string }

export type AgentSurfaceObserver = (event: AgentSurfaceEvent) => void

const VALID_JSON_SCHEMA_TYPES = new Set(["null", "boolean", "object", "array", "number", "string", "integer"])
const PRODUCT_PLAN_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/
const PRODUCT_BILLING_KEY_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validateJsonSchemaObject(value: unknown, path = "inputSchema"): asserts value is JsonSchema {
  if (!isRecord(value)) throw new Error(`${path} must be a JSON Schema object.`)

  if (value.type !== undefined) {
    const types = typeof value.type === "string" ? [value.type] : value.type
    if (!Array.isArray(types) || !types.length || types.some((item) => typeof item !== "string" || !VALID_JSON_SCHEMA_TYPES.has(item)) || new Set(types).size !== types.length) {
      throw new Error(`${path}.type must contain valid JSON Schema types.`)
    }
  }

  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) throw new Error(`${path}.properties must be an object.`)
    for (const [key, propertySchema] of Object.entries(value.properties)) {
      validateJsonSchemaObject(propertySchema, `${path}.properties.${key}`)
    }
  }

  if (value.required !== undefined) {
    if (!Array.isArray(value.required) || value.required.some((item) => typeof item !== "string")) throw new Error(`${path}.required must be a string array.`)
    if (new Set(value.required).size !== value.required.length) throw new Error(`${path}.required must not contain duplicate property names.`)
  }

  if (value.items !== undefined) {
    if (Array.isArray(value.items)) {
      for (const item of value.items) validateJsonSchemaObject(item, `${path}.items`)
    } else validateJsonSchemaObject(value.items, `${path}.items`)
  }
}

export function validateAgentToolDefinition(tool: unknown): asserts tool is AgentToolDefinition {
  if (!isRecord(tool)) throw new Error("Agent tool definition must be an object.")
  if (typeof tool.name !== "string" || !tool.name.trim()) throw new Error("Agent tool name is required.")
  if (typeof tool.description !== "string" || !tool.description.trim()) throw new Error(`Agent tool ${tool.name || "<unknown>"} requires a description.`)
  if (tool.title !== undefined && (typeof tool.title !== "string" || !tool.title.trim())) throw new Error(`Agent tool ${tool.name} has an invalid title.`)
  if (tool.kind !== "read" && tool.kind !== "mutation") throw new Error(`Agent tool ${tool.name} must declare kind as read or mutation.`)
  if (typeof tool.returnsUntrustedContent !== "boolean") throw new Error(`Agent tool ${tool.name} must explicitly declare returnsUntrustedContent.`)
  if (typeof tool.requiresConfirmation !== "boolean") throw new Error(`Agent tool ${tool.name} must explicitly declare requiresConfirmation.`)
  if (tool.confirmationMessage !== undefined && (typeof tool.confirmationMessage !== "string" || !tool.confirmationMessage.trim())) throw new Error(`Agent tool ${tool.name} has an invalid confirmation message.`)
  if (typeof tool.execute !== "function") throw new Error(`Agent tool ${tool.name} requires an execute function.`)
  validateJsonSchemaObject(tool.inputSchema)
}

export function validateAgentToolDefinitions(tools: readonly AgentToolDefinition[]): readonly AgentToolDefinition[] {
  if (!Array.isArray(tools)) throw new Error("Agent tools must be an array.")
  const names = new Set<string>()
  for (const tool of tools) {
    validateAgentToolDefinition(tool)
    if (names.has(tool.name)) throw new Error(`Duplicate agent tool name: ${tool.name}.`)
    names.add(tool.name)
  }
  return tools
}

export function defineAgentTool<Input, Output>(tool: AgentToolDefinition<Input, Output>): AgentToolDefinition<Input, Output> {
  validateAgentToolDefinition(tool)
  return tool
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

function validateStringKeyMap(value: unknown, path: string, valueValidator: (candidate: unknown) => boolean, valueDescription: string) {
  if (value === undefined) return
  if (!isRecord(value)) throw new Error(`${path} must be an object keyed by product keys.`)
  for (const [key, candidate] of Object.entries(value)) {
    if (!PRODUCT_BILLING_KEY_PATTERN.test(key)) throw new Error(`${path}.${key} is not a valid product key.`)
    if (!valueValidator(candidate)) throw new Error(`${path}.${key} must be ${valueDescription}.`)
  }
}

function validateProductPlan(plan: unknown, index: number, keys: Set<string>) {
  const path = `catalog.plans[${index}]`
  if (!isRecord(plan)) throw new Error(`${path} must be an object.`)
  if (typeof plan.key !== "string" || !PRODUCT_PLAN_KEY_PATTERN.test(plan.key) || keys.has(plan.key)) throw new Error(`Invalid or duplicate product plan key: ${String(plan.key)}`)
  if (typeof plan.name !== "string" || !plan.name.trim()) throw new Error(`Plan ${plan.key} must have a display name.`)
  if (plan.active !== undefined && typeof plan.active !== "boolean") throw new Error(`Plan ${plan.key} active must be a boolean.`)
  if (plan.recommended !== undefined && typeof plan.recommended !== "boolean") throw new Error(`Plan ${plan.key} recommended must be a boolean.`)
  for (const sortKey of ["sort_order", "sortOrder"]) {
    if (plan[sortKey] !== undefined && (!Number.isSafeInteger(plan[sortKey]) || Number(plan[sortKey]) < 0)) throw new Error(`Plan ${plan.key} ${sortKey} must be a non-negative integer.`)
  }
  if (plan.description !== undefined && (typeof plan.description !== "string" || !plan.description.trim())) throw new Error(`Plan ${plan.key} description must be non-empty copy.`)
  if (plan.prices !== undefined) {
    if (!isRecord(plan.prices)) throw new Error(`Plan ${plan.key} prices must be an object keyed by billing interval.`)
    for (const [interval, price] of Object.entries(plan.prices)) {
      if (!isBillingInterval(interval)) throw new Error(`Plan ${plan.key} has an unsupported billing interval: ${interval}.`)
      if (!isRecord(price)) throw new Error(`Plan ${plan.key} price ${interval} must be an object.`)
      if (typeof price.amount !== "number" && price.amount !== null || typeof price.amount === "number" && (!Number.isFinite(price.amount) || price.amount < 0)) throw new Error(`Plan ${plan.key} price ${interval} amount must be a non-negative number or null.`)
      if (typeof price.currency !== "string" || !/^[A-Z]{3}$/.test(price.currency)) throw new Error(`Plan ${plan.key} price ${interval} currency must be an uppercase ISO-4217 code.`)
      if (price.providerPriceId !== undefined && (typeof price.providerPriceId !== "string" || !price.providerPriceId.trim())) throw new Error(`Plan ${plan.key} price ${interval} providerPriceId must be non-empty copy.`)
    }
  }
  validateStringKeyMap(plan.features, `${path}.features`, (candidate) => typeof candidate === "boolean", "a boolean")
  validateStringKeyMap(plan.limits, `${path}.limits`, (candidate) => candidate === null || typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0, "a non-negative integer or null")
  if (plan.metadata !== undefined && !isRecord(plan.metadata)) throw new Error(`${path}.metadata must be an object.`)
  keys.add(plan.key)
}

/** Return whether a value can be used as a stable product plan key. */
export function isProductPlanKey(value: unknown): value is string {
  return typeof value === "string" && PRODUCT_PLAN_KEY_PATTERN.test(value)
}

/** Validate one plan without requiring it to be the catalog fallback plan. */
export function validatePlanDefinition(value: unknown): ProductPlan {
  const keys = new Set<string>()
  validateProductPlan(value, 0, keys)
  return value as ProductPlan
}

function canonicalizePlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalizePlanValue(item))
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalizePlanValue(value[key])]))
  return value
}

function commercialMetadata(value: Readonly<Record<string, unknown>> | undefined) {
  const metadata = { ...(value || {}) }
  // The catalog sync stores this presentation hint in metadata for backwards
  // compatibility, but it is not an entitlement or pricing decision.
  delete metadata.recommended
  return metadata
}

function planCommercialFingerprint(plan: ProductPlan) {
  return JSON.stringify(canonicalizePlanValue({
    // Metadata may contain provider-neutral pricing and is therefore part of
    // the commercial contract. Description/name/order remain presentation.
    features: plan.features || {},
    limits: plan.limits || {},
    metadata: commercialMetadata(plan.metadata),
    prices: plan.prices || {},
  }))
}

/**
 * Commercial entitlement changes are protected separately from presentation
 * changes by the managed application. This keeps historical subscriptions
 * explainable without freezing labels or ordering.
 */
export function hasCommercialPlanChange(before: ProductPlan, after: ProductPlan) {
  validatePlanDefinition(before)
  validatePlanDefinition(after)
  return planCommercialFingerprint(before) !== planCommercialFingerprint(after)
}

export function classifyProductPlanChange(before: ProductPlan, after: ProductPlan): ProductPlanChangeScope {
  validatePlanDefinition(before)
  validatePlanDefinition(after)
  if (before.key !== after.key) return "identity"
  if (hasCommercialPlanChange(before, after)) return "commercial"
  const presentationBefore = JSON.stringify(canonicalizePlanValue({ key: before.key, name: before.name, description: before.description, active: before.active, recommended: before.recommended, sort_order: before.sort_order ?? before.sortOrder }))
  const presentationAfter = JSON.stringify(canonicalizePlanValue({ key: after.key, name: after.name, description: after.description, active: after.active, recommended: after.recommended, sort_order: after.sort_order ?? after.sortOrder }))
  return presentationBefore === presentationAfter ? "none" : "presentation"
}

/**
 * Normalize the two historical sort-order spellings and optional maps into a
 * stable, serializable plan definition. The function never mutates its input.
 */
export function normalizeProductPlan(value: unknown): ProductPlan {
  const plan = validatePlanDefinition(value)
  const normalizedPrices = plan.prices
    ? Object.fromEntries(Object.entries(plan.prices).map(([interval, price]) => [interval, { amount: price.amount, currency: price.currency, ...(price.providerPriceId ? { providerPriceId: price.providerPriceId } : {}) }]))
    : undefined
  return {
    key: plan.key,
    name: plan.name.trim(),
    ...(plan.description === undefined ? {} : { description: plan.description.trim() }),
    active: plan.active !== false,
    ...(plan.recommended === undefined ? {} : { recommended: plan.recommended }),
    sort_order: plan.sort_order ?? plan.sortOrder ?? 0,
    ...(normalizedPrices ? { prices: normalizedPrices } : {}),
    features: { ...(plan.features || {}) },
    limits: { ...(plan.limits || {}) },
    metadata: { ...(plan.metadata || {}) },
  }
}

/**
 * Duplicate a plan as an inactive definition. Provider price references are
 * intentionally not copied; a consumer must explicitly map the new key.
 */
export function duplicateProductPlan(
  source: ProductPlan,
  newKey: string,
  overrides: Partial<Omit<ProductPlan, "key" | "active">> = {},
): ProductPlan {
  const plan = normalizeProductPlan(source)
  if (!isProductPlanKey(newKey)) throw new Error(`Invalid product plan key: ${newKey}`)
  const prices = plan.prices
    ? Object.fromEntries(Object.entries(plan.prices).map(([interval, price]) => [interval, { amount: price.amount, currency: price.currency }]))
    : undefined
  return normalizeProductPlan({ ...plan, ...overrides, key: newKey, active: false, ...(prices ? { prices } : {}) })
}

function validateUsageMetrics(value: unknown) {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new Error("catalog.usageMetrics must be an array.")
  const keys = new Set<string>()
  for (const [index, metric] of value.entries()) {
    if (!isRecord(metric) || typeof metric.key !== "string" || !PRODUCT_BILLING_KEY_PATTERN.test(metric.key) || keys.has(metric.key)) throw new Error(`Invalid or duplicate product usage metric at index ${index}.`)
    if (typeof metric.name !== "string" || !metric.name.trim()) throw new Error(`Product usage metric ${metric.key} must have a display name.`)
    if (metric.unit !== undefined && (typeof metric.unit !== "string" || !metric.unit.trim())) throw new Error(`Product usage metric ${metric.key} unit must be non-empty copy.`)
    keys.add(metric.key)
  }
}

function validateBillingPresentationReferences(catalog: ProductCatalog, presentation: ProductBillingPresentation, path: string) {
  validateBillingPresentation(presentation, path)
  if (presentation.planOrder) resolvePlanOrder(catalog.plans.map((plan) => plan.key), presentation.planOrder)
  const featureKeys = new Set(catalog.plans.flatMap((plan) => Object.keys(plan.features || {})))
  const limitKeys = new Set(catalog.plans.flatMap((plan) => Object.keys(plan.limits || {})))
  for (const key of presentation.featureKeys || []) if (!featureKeys.has(key)) throw new Error(`${path}.featureKeys references an undefined feature key: ${key}.`)
  for (const key of presentation.limitKeys || []) if (!limitKeys.has(key)) throw new Error(`${path}.limitKeys references an undefined limit key: ${key}.`)
  for (const row of [...(presentation.comparison || []), ...(presentation.comparisonRows || [])]) {
    if (row.kind === "feature" && row.featureKey && !featureKeys.has(row.featureKey)) throw new Error(`${path}.comparison references an undefined feature key: ${row.featureKey}.`)
    if (row.kind === "limit" && row.limitKey && !limitKeys.has(row.limitKey)) throw new Error(`${path}.comparison references an undefined limit key: ${row.limitKey}.`)
  }
  for (const key of Object.keys(presentation.plans || {})) if (!catalog.plans.some((plan) => plan.key === key)) throw new Error(`${path}.plans references an undefined plan key: ${key}.`)
}

function validateBillingAliases(catalog: ProductCatalog) {
  const policies = [
    ["catalog.billing", catalog.billing],
    ["catalog.billingPolicy", catalog.billingPolicy],
  ] as const
  for (const [path, policy] of policies) {
    if (policy === undefined) continue
    validateBillingPolicy(policy, path)
    if (policy.presentation !== undefined) validateBillingPresentationReferences(catalog, policy.presentation, `${path}.presentation`)
    if (policy.defaultPlanKey !== undefined && policy.defaultPlanKey !== catalog.defaultPlanKey) throw new Error(`${path}.defaultPlanKey must match catalog.defaultPlanKey.`)
    if (policy.fallbackPlanKey !== undefined && !catalog.plans.some((plan) => plan.key === policy.fallbackPlanKey)) throw new Error(`${path}.fallbackPlanKey must identify an existing plan.`)
    if (policy.defaultInterval && policy.supportedIntervals && !policy.supportedIntervals.includes(policy.defaultInterval)) throw new Error(`${path}.defaultInterval must be listed in supportedIntervals.`)
  }
  const presentations = [
    ["catalog.presentation", catalog.presentation],
    ["catalog.billingPresentation", catalog.billingPresentation],
  ] as const
  for (const [path, presentation] of presentations) {
    if (presentation === undefined) continue
    validateBillingPresentationReferences(catalog, presentation, path)
  }
}

export function validateProductCatalog(value: unknown): ProductCatalog {
  if (!isRecord(value)) throw new Error("Product catalog must be an object.")
  if (typeof value.defaultPlanKey !== "string" || !PRODUCT_PLAN_KEY_PATTERN.test(value.defaultPlanKey)) throw new Error("The product catalog must define a valid default plan key.")
  if (!Array.isArray(value.plans)) throw new Error("The product catalog must define a plans array.")
  const keys = new Set<string>()
  for (const [index, plan] of value.plans.entries()) validateProductPlan(plan, index, keys)
  if (!keys.has(value.defaultPlanKey)) throw new Error("The product catalog must define an existing default plan key.")
  const defaultPlan = value.plans.find((plan) => isRecord(plan) && plan.key === value.defaultPlanKey)
  if (!isRecord(defaultPlan?.limits) || !Object.prototype.hasOwnProperty.call(defaultPlan.limits, "core.workspaces")) throw new Error("The default plan must explicitly define limits.core.workspaces; use null only for intentional unlimited workspaces.")
  validateUsageMetrics(value.usageMetrics)
  validateBillingAliases(value as ProductCatalog)
  return value as ProductCatalog
}

export function defineProductConfig<T extends ProductConfigContract>(config: T): T {
  if (!isRecord(config)) throw new Error("Product config must be an object.")
  if (!isRecord(config.identity)) throw new Error("Product identity is required.")
  if (typeof config.identity.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(config.identity.slug)) throw new Error("Product slug must be kebab-case.")
  if (typeof config.identity.name !== "string" || !config.identity.name.trim()) throw new Error("Product name is required.")
  validateProductCatalog(config.catalog)
  for (const [path, policy] of [["billing", config.billing], ["billingPolicy", config.billingPolicy]] as const) {
    if (policy === undefined) continue
    validateBillingPolicy(policy, path)
    if (policy.presentation !== undefined) validateBillingPresentation(policy.presentation, `${path}.presentation`)
    if (policy.defaultPlanKey !== undefined && policy.defaultPlanKey !== config.catalog.defaultPlanKey) throw new Error(`${path}.defaultPlanKey must match catalog.defaultPlanKey.`)
  }
  if (config.billingPresentation !== undefined) {
    validateBillingPresentationReferences(config.catalog, config.billingPresentation, "billingPresentation")
    if (config.billingPresentation.planOrder) resolvePlanOrder(config.catalog.plans.map((plan) => plan.key), config.billingPresentation.planOrder)
    const featureKeys = new Set(config.catalog.plans.flatMap((plan) => Object.keys(plan.features || {})))
    const limitKeys = new Set(config.catalog.plans.flatMap((plan) => Object.keys(plan.limits || {})))
    for (const key of config.billingPresentation.featureKeys || []) if (!featureKeys.has(key)) throw new Error(`billingPresentation.featureKeys references an undefined feature key: ${key}.`)
    for (const key of config.billingPresentation.limitKeys || []) if (!limitKeys.has(key)) throw new Error(`billingPresentation.limitKeys references an undefined limit key: ${key}.`)
    for (const row of [...(config.billingPresentation.comparison || []), ...(config.billingPresentation.comparisonRows || [])]) {
      if (row.kind === "feature" && row.featureKey && !featureKeys.has(row.featureKey)) throw new Error(`billingPresentation.comparison references an undefined feature key: ${row.featureKey}.`)
      if (row.kind === "limit" && row.limitKey && !limitKeys.has(row.limitKey)) throw new Error(`billingPresentation.comparison references an undefined limit key: ${row.limitKey}.`)
    }
    for (const key of Object.keys(config.billingPresentation.plans || {})) if (!config.catalog.plans.some((plan) => plan.key === key)) throw new Error(`billingPresentation.plans references an undefined plan key: ${key}.`)
  }
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
