import { createHash } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"

const WINDOW_SECONDS = 60
const MAX_ATTEMPTS = 10

type HeaderReader = Pick<globalThis.Headers, "get">

export function getRequestClientIdentity(requestHeaders: HeaderReader) {
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim()
  const realIp = requestHeaders.get("x-real-ip")?.trim()
  return forwarded || realIp || "unknown-client"
}

function getRateLimitSecret() {
  return process.env.RESERVEVIA_RATE_LIMIT_SECRET || (process.env.NODE_ENV === "production" ? null : "reservevia-local-rate-limit-secret")
}

export async function enforcePublicReservationRateLimit(input: { restaurantId: string; clientIdentity: string }) {
  const secret = getRateLimitSecret()
  if (!secret) {
    console.error("Public reservation rate limiting is not configured.")
    return { allowed: false, message: "Reservations are temporarily unavailable. Please try again shortly." }
  }

  const keyHash = createHash("sha256")
    .update(`${secret}:${input.restaurantId}:${input.clientIdentity}`)
    .digest("hex")

  try {
    const { data, error } = await createServiceRoleClient().rpc("consume_public_reservation_rate_limit", {
      p_key_hash: keyHash,
      p_window_seconds: WINDOW_SECONDS,
      p_max_attempts: MAX_ATTEMPTS,
    })
    if (error) throw error
    return data === true
      ? { allowed: true, message: null }
      : { allowed: false, message: "Too many reservation attempts. Please wait a moment and try again." }
  } catch (error) {
    console.error("Public reservation rate-limit check failed:", error instanceof Error ? error.message : "unknown error")
    return { allowed: false, message: "Reservations are temporarily unavailable. Please try again shortly." }
  }
}
