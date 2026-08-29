export const CORE_VERSION = "2.1.0"
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
