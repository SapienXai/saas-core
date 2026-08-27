import "server-only"

import { Vercel } from "@vercel/sdk"

export type VercelVerificationChallenge = {
  type: string
  domain: string
  value: string
  reason: string
}

export type VercelDnsConfiguration = {
  configuredBy: string | null
  misconfigured: boolean
  recommendedIPv4: Array<{ rank: number; value: string[] }>
  recommendedCNAME: Array<{ rank: number; value: string }>
}

export type VercelProjectDomain = {
  name: string
  verified: boolean
  verification?: VercelVerificationChallenge[]
  projectId?: string
}

export type VercelDomainOperationResult = {
  domain: VercelProjectDomain
  dns: VercelDnsConfiguration | null
}

export class VercelProviderError extends Error {
  readonly code: "NOT_CONFIGURED" | "PROVIDER_ERROR" | "DOMAIN_CONFLICT" | "DOMAIN_RELEASING" | "DOMAIN_NOT_FOUND"
  readonly details?: unknown

  constructor(code: VercelProviderError["code"], message: string, details?: unknown) {
    super(message)
    this.name = "VercelProviderError"
    this.code = code
    this.details = details
  }
}

function getProviderConfig() {
  const token = process.env.VERCEL_API_TOKEN?.trim()
  const projectId = process.env.VERCEL_PROJECT_ID?.trim()
  const rawTeamId = process.env.VERCEL_TEAM_ID?.trim()
  if (!isUsableProviderValue(token) || !isUsableProviderValue(projectId) || !isUsableProviderValue(rawTeamId)) {
    throw new VercelProviderError(
      "NOT_CONFIGURED",
      "Vercel domain management is not configured for this environment.",
    )
  }
  return {
    token: token as string,
    projectId: projectId as string,
    teamId: rawTeamId as string,
  }
}

function isUsableProviderValue(value: string | undefined) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 &&
    !normalized.includes("placeholder") &&
    !normalized.includes("your_") &&
    !normalized.includes("your-") &&
    normalized !== "changeme"
}

function createClient() {
  const config = getProviderConfig()
  return { client: new Vercel({ bearerToken: config.token }), config }
}

function providerError(error: unknown) {
  const message = error instanceof Error ? error.message : "Vercel domain operation failed."
  const body = error && typeof error === "object" && "body" in error && typeof error.body === "string"
    ? error.body
    : ""
  let providerCode = ""
  let providerMessage = ""
  try {
    const parsed = JSON.parse(body) as { code?: unknown; message?: unknown }
    providerCode = typeof parsed.code === "string" ? parsed.code : ""
    providerMessage = typeof parsed.message === "string" ? parsed.message : ""
  } catch {
    // The SDK can also return a non-JSON error body. The raw message remains
    // useful for the conservative classification below.
  }

  const normalized = `${providerCode} ${providerMessage} ${message} ${body}`.toLowerCase()
  if (
    (typeof error === "object" && error !== null && "statusCode" in error && (error.statusCode === 401 || error.statusCode === 403)) ||
    normalized.includes("invalidtoken") ||
    normalized.includes("invalid token") ||
    normalized.includes("not authorized") ||
    normalized.includes("unauthorized")
  ) {
    return new VercelProviderError(
      "NOT_CONFIGURED",
      "Vercel credentials are invalid or do not have access to the configured project/team.",
      error,
    )
  }
  if (typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 404) {
    return new VercelProviderError("DOMAIN_NOT_FOUND", "Vercel could not find this project domain.", error)
  }
  if (normalized.includes("releas") || normalized.includes("being deleted") || normalized.includes("recently removed")) {
    return new VercelProviderError("DOMAIN_RELEASING", "Vercel is still releasing this domain from its previous assignment.", error)
  }
  if (
    normalized.includes("domain_already_owned") ||
    normalized.includes("already owned") ||
    normalized.includes("another project") ||
    normalized.includes("another team") ||
    normalized.includes("cannot be claimed") ||
    normalized.includes("already assigned") ||
    normalized.includes("already exists")
  ) {
    return new VercelProviderError("DOMAIN_CONFLICT", "Vercel refused this domain because it is already assigned or cannot be claimed by this project.", error)
  }
  return new VercelProviderError("PROVIDER_ERROR", "Vercel domain operation failed.", error)
}

function toProjectDomain(value: { name: string; verified: boolean; verification?: VercelVerificationChallenge[]; projectId?: string }) {
  return {
    name: value.name,
    verified: value.verified,
    verification: value.verification,
    projectId: value.projectId,
  }
}

function toDnsConfiguration(value: {
  configuredBy: string | null
  misconfigured: boolean
  recommendedIPv4: Array<{ rank: number; value: string[] }>
  recommendedCNAME: Array<{ rank: number; value: string }>
} | null): VercelDnsConfiguration | null {
  if (!value) return null
  return {
    configuredBy: value.configuredBy,
    misconfigured: value.misconfigured,
    recommendedIPv4: value.recommendedIPv4 || [],
    recommendedCNAME: value.recommendedCNAME || [],
  }
}

async function getDns(client: Vercel, hostname: string, projectId: string, teamId?: string) {
  try {
    const config = await client.domains.getDomainConfig({
      domain: hostname,
      projectIdOrName: projectId,
      ...(teamId ? { teamId } : {}),
    })
    return toDnsConfiguration(config)
  } catch (error) {
    console.warn("SaaS Core Vercel DNS configuration lookup failed", {
      hostname,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

export async function addProjectDomain(hostname: string): Promise<VercelDomainOperationResult> {
  const { client, config } = createClient()
  try {
    const domain = await client.projects.addProjectDomain({
      idOrName: config.projectId,
      ...(config.teamId ? { teamId: config.teamId } : {}),
      requestBody: { name: hostname },
    })
    return {
      domain: toProjectDomain(domain),
      dns: await getDns(client, hostname, config.projectId, config.teamId),
    }
  } catch (error) {
    throw providerError(error)
  }
}

export async function getProjectDomain(hostname: string): Promise<VercelDomainOperationResult> {
  const { client, config } = createClient()
  try {
    const domain = await client.projects.getProjectDomain({
      idOrName: config.projectId,
      domain: hostname,
      ...(config.teamId ? { teamId: config.teamId } : {}),
    })
    return {
      domain: toProjectDomain(domain),
      dns: await getDns(client, hostname, config.projectId, config.teamId),
    }
  } catch (error) {
    throw providerError(error)
  }
}

export async function getDomainConfiguration(hostname: string) {
  const { client, config } = createClient()
  try {
    const dns = await client.domains.getDomainConfig({
      domain: hostname,
      projectIdOrName: config.projectId,
      ...(config.teamId ? { teamId: config.teamId } : {}),
    })
    return toDnsConfiguration(dns)
  } catch (error) {
    throw providerError(error)
  }
}

export async function verifyProjectDomain(hostname: string): Promise<VercelDomainOperationResult> {
  const { client, config } = createClient()
  try {
    const domain = await client.projects.verifyProjectDomain({
      idOrName: config.projectId,
      domain: hostname,
      ...(config.teamId ? { teamId: config.teamId } : {}),
    })
    return {
      domain: toProjectDomain(domain),
      dns: await getDns(client, hostname, config.projectId, config.teamId),
    }
  } catch (error) {
    throw providerError(error)
  }
}

export async function removeProjectDomain(hostname: string) {
  const { client, config } = createClient()
  try {
    await client.projects.removeProjectDomain({
      idOrName: config.projectId,
      domain: hostname,
      ...(config.teamId ? { teamId: config.teamId } : {}),
      requestBody: { removeRedirects: false },
    })
  } catch (error) {
    throw providerError(error)
  }
}

export function isVercelProviderConfigured() {
  return isUsableProviderValue(process.env.VERCEL_API_TOKEN) && isUsableProviderValue(process.env.VERCEL_PROJECT_ID) && isUsableProviderValue(process.env.VERCEL_TEAM_ID)
}
