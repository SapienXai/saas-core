import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { ApiDomainError } from "@/lib/ai/contracts"
import { createServiceRoleClient } from "@/lib/supabase"

export const API_SCOPES = [
  "restaurants:read",
  "availability:read",
  "reservations:write",
  "reservations:manage",
  "dataengine:reservevia:write",
] as const
export type ApiScope = (typeof API_SCOPES)[number]

function credentialPepper() {
  if (process.env.RESERVEVIA_API_CREDENTIAL_PEPPER) return process.env.RESERVEVIA_API_CREDENTIAL_PEPPER
  if (process.env.NODE_ENV === "production") return null
  return process.env.RESERVEVIA_RATE_LIMIT_SECRET || "reservevia-local-api-pepper"
}

function hashCredential(value: string) {
  const pepper = credentialPepper()
  if (!pepper) throw new ApiDomainError("INTERNAL_ERROR", "API credentials are not configured.", false, "contact_support", 503)
  return createHash("sha256").update(`${pepper}:${value}`).digest("hex")
}

export type ApiClient = {
  id: string
  name: string
  scopes: string[]
  rate_limit_profile: string
}

export async function authenticateApiRequest(request: Request, requiredScope?: ApiScope): Promise<ApiClient>
export async function authenticateApiRequest(request: Request, requiredScope: ApiScope | undefined, options: { allowAnonymous?: boolean }): Promise<ApiClient | null>
export async function authenticateApiRequest(request: Request, requiredScope?: ApiScope, options: { allowAnonymous?: boolean } = {}): Promise<ApiClient | null> {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) {
    if (options.allowAnonymous) return null
    throw new ApiDomainError("UNAUTHORIZED_CLIENT", "A trusted ReserveVia client credential is required.", false, "authenticate_client", 401)
  }
  const credential = header.slice("Bearer ".length).trim()
  if (!/^rv_(live|test)_[A-Za-z0-9_-]{20,}$/.test(credential)) {
    throw new ApiDomainError("UNAUTHORIZED_CLIENT", "The client credential is invalid.", false, "authenticate_client", 401)
  }
  const supabase = createServiceRoleClient() as any
  const result = await supabase
    .from("api_clients")
    .select("id, name, scopes, rate_limit_profile")
    .eq("credential_hash", hashCredential(credential))
    .eq("status", "active")
    .maybeSingle()
  if (result.error || !result.data) throw new ApiDomainError("UNAUTHORIZED_CLIENT", "The client credential is invalid.", false, "authenticate_client", 401)
  const client = result.data as ApiClient
  if (requiredScope && !client.scopes.includes(requiredScope)) {
    throw new ApiDomainError("FORBIDDEN", `The client is missing the ${requiredScope} scope.`, false, "request_scope", 403)
  }
  await supabase.from("api_clients").update({ last_used_at: new Date().toISOString() }).eq("id", client.id)
  return client
}

export async function issueApiClient(input: { name: string; scopes: ApiScope[]; rateLimitProfile?: "standard" | "partner" | "internal" }) {
  const name = input.name.trim()
  const scopes = Array.from(new Set(input.scopes))
  if (!name || name.length > 120) throw new Error("API client name must be between 1 and 120 characters.")
  if (scopes.length === 0 || scopes.some((scope) => !API_SCOPES.includes(scope))) throw new Error("API client scope is not supported.")
  if (scopes.includes("dataengine:reservevia:write") && (scopes.length !== 1 || input.rateLimitProfile !== "internal")) throw new Error("DataEngine credentials must have only dataengine:reservevia:write and the internal rate limit profile.")
  const rateLimitProfile = input.rateLimitProfile || "standard"
  if (!["standard", "partner", "internal"].includes(rateLimitProfile)) throw new Error("API client rate limit profile is not supported.")
  const raw = `rv_live_${randomBytes(32).toString("base64url")}`
  const supabase = createServiceRoleClient() as any
  const result = await supabase.from("api_clients").insert({
    name,
    credential_hash: hashCredential(raw),
    scopes,
    rate_limit_profile: rateLimitProfile,
  }).select("id, name, scopes, rate_limit_profile, created_at").single()
  if (result.error) throw new Error(result.error.message)
  return { client: result.data, credential: raw }
}
