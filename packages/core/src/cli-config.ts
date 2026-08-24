export const CORE_VERSION = "1.1.0"
export const CORE_SCHEMA_VERSION = "1.3.0"

export type OptionalModule = "billing" | "email" | "domains" | "pwa" | "push" | "platform" | "coreLab"

export type CliFlags = {
  yes: boolean
  nonInteractive: boolean
  dryRun: boolean
  withBilling: boolean
  withoutBilling: boolean
  withEmail: boolean
  withoutEmail: boolean
  withDomains: boolean
  withPwa: boolean
  withPush: boolean
  withPlatform: boolean
  withoutPlatform: boolean
}

export type ResolvedCliConfig = {
  version: typeof CORE_VERSION
  billing: boolean
  email: boolean
  domains: boolean
  pwa: boolean
  push: boolean
  platform: boolean
  coreLab: boolean
  installDependencies: boolean
}

export const DEFAULT_CLI_CONFIG: Omit<ResolvedCliConfig, "version" | "installDependencies"> = {
  billing: true,
  email: true,
  domains: false,
  pwa: false,
  push: false,
  platform: true,
  coreLab: true,
}

export function parseCliFlags(argv: string[]): CliFlags {
  return {
    yes: argv.includes("--yes"),
    nonInteractive: argv.includes("--non-interactive"),
    dryRun: argv.includes("--dry-run"),
    withBilling: argv.includes("--with-billing"),
    withoutBilling: argv.includes("--without-billing"),
    withEmail: argv.includes("--with-email"),
    withoutEmail: argv.includes("--without-email"),
    withDomains: argv.includes("--with-domains"),
    withPwa: argv.includes("--with-pwa"),
    withPush: argv.includes("--with-push"),
    withPlatform: argv.includes("--with-platform"),
    withoutPlatform: argv.includes("--without-platform"),
  }
}

export function resolveCliConfig(input: Partial<ResolvedCliConfig> & { flags?: Partial<CliFlags>; interactive?: boolean } = {}): ResolvedCliConfig {
  const flags = input.flags ?? {}
  const value = (name: OptionalModule, enabledFlag: keyof CliFlags, disabledFlag?: keyof CliFlags) => {
    const explicit = disabledFlag && flags[disabledFlag] ? false : flags[enabledFlag] ? true : undefined
    return explicit ?? input[name] ?? DEFAULT_CLI_CONFIG[name]
  }
  return {
    version: CORE_VERSION,
    billing: value("billing", "withBilling", "withoutBilling"),
    email: value("email", "withEmail", "withoutEmail"),
    domains: value("domains", "withDomains"),
    pwa: value("pwa", "withPwa"),
    push: value("push", "withPush"),
    platform: value("platform", "withPlatform", "withoutPlatform"),
    coreLab: input.coreLab ?? DEFAULT_CLI_CONFIG.coreLab,
    installDependencies: input.installDependencies ?? Boolean(input.interactive),
  }
}

export function modulesForConfig(config: ResolvedCliConfig): string[] {
  return [
    "auth", "workspace", "permissions", "invitations", "entitlements", "usage", "audit",
    ...(config.billing ? ["billing"] : []),
    ...(config.email ? ["notifications"] : []),
    ...(config.domains ? ["domains"] : []),
    ...(config.pwa ? ["pwa"] : []),
    ...(config.push ? ["push"] : []),
    ...(config.platform ? ["platform"] : []),
    ...(config.coreLab ? ["core-lab"] : []),
  ]
}

export function configFromManifest(manifest: { configuration?: Partial<ResolvedCliConfig>; installedModules?: string[]; providers?: Record<string, string> }): ResolvedCliConfig {
  if (manifest.configuration) return resolveCliConfig(manifest.configuration)
  const modules = new Set(manifest.installedModules ?? [])
  return resolveCliConfig({
    billing: modules.has("billing") || manifest.providers?.billing === "paddle",
    email: modules.has("notifications") || manifest.providers?.email === "resend",
    domains: modules.has("domains"),
    pwa: modules.has("pwa"),
    push: modules.has("push"),
    platform: modules.has("platform"),
    coreLab: modules.has("core-lab"),
  })
}

export type CompatibilityResult = { status: "compatible" | "warning" | "incompatible"; detail: string }

export function evaluateCompatibility(input: { packageVersions: Record<string, string | undefined>; schemaVersion?: string; manifestVersion?: string }): CompatibilityResult {
  const versions = Object.entries(input.packageVersions).filter(([, version]) => version).map(([, version]) => version!.replace(/^[^0-9]*/, ""))
  const distinct = new Set(versions)
  if (distinct.size > 1) return { status: "incompatible", detail: `Core package versions are not aligned: ${[...distinct].join(", ")}` }
  if (input.schemaVersion && input.schemaVersion !== CORE_SCHEMA_VERSION) return { status: "warning", detail: `Schema ${input.schemaVersion} requires migration to ${CORE_SCHEMA_VERSION}.` }
  if (input.manifestVersion && input.manifestVersion !== CORE_VERSION) return { status: "warning", detail: `Generated project manifest is ${input.manifestVersion}; current Core is ${CORE_VERSION}.` }
  return { status: "compatible", detail: `Core ${CORE_VERSION} with schema ${CORE_SCHEMA_VERSION}.` }
}
