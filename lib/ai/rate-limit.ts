import "server-only"

import { createHash } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { ApiDomainError } from "@/lib/ai/contracts"

export type AiRateLimitPolicy = "business_feed" | "restaurant_search" | "restaurant_detail" | "availability" | "hold_creation" | "reservation_creation" | "reservation_management" | "dataengine_ingest" | "mcp"

const POLICIES: Record<AiRateLimitPolicy, { windowSeconds: number; maxAttempts: number }> = {
  business_feed: { windowSeconds: 60, maxAttempts: 30 },
  restaurant_search: { windowSeconds: 60, maxAttempts: 60 },
  restaurant_detail: { windowSeconds: 60, maxAttempts: 100 },
  availability: { windowSeconds: 60, maxAttempts: 100 },
  hold_creation: { windowSeconds: 60, maxAttempts: 20 },
  reservation_creation: { windowSeconds: 60, maxAttempts: 10 },
  reservation_management: { windowSeconds: 60, maxAttempts: 30 },
  dataengine_ingest: { windowSeconds: 60, maxAttempts: 20 },
  mcp: { windowSeconds: 60, maxAttempts: 60 },
}

export async function enforceAiRateLimit(input: { policy: AiRateLimitPolicy; identity: string }) {
  const secret = process.env.RESERVEVIA_RATE_LIMIT_SECRET || (process.env.NODE_ENV === "production" ? null : "reservevia-local-rate-limit-secret")
  if (!secret) throw new ApiDomainError("INTERNAL_ERROR", "Rate limiting is not configured.", false, "contact_support", 503)
  const policy = POLICIES[input.policy]
  const keyHash = createHash("sha256").update(`${secret}:ai:${input.policy}:${input.identity}`).digest("hex")
  const { data, error } = await (createServiceRoleClient() as any).rpc("consume_public_reservation_rate_limit", {
    p_key_hash: keyHash,
    p_window_seconds: policy.windowSeconds,
    p_max_attempts: policy.maxAttempts,
  })
  if (error || data !== true) throw new ApiDomainError("RATE_LIMITED", "This ReserveVia endpoint is temporarily rate limited.", true, "retry_after_delay", 429)
  return true
}

export function requestIdentity(request: Request, clientId?: string | null) {
  if (clientId) return `client:${clientId}`
  return `network:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip")?.trim() || "unknown-client"}`
}
