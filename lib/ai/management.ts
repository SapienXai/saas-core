import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { ApiDomainError } from "@/lib/ai/contracts"
import { createServiceRoleClient } from "@/lib/supabase"

function managementSecret() {
  return process.env.RESERVEVIA_MANAGEMENT_TOKEN_SECRET || process.env.RESERVEVIA_RATE_LIMIT_SECRET || (process.env.NODE_ENV === "production" ? null : "reservevia-local-management-secret")
}

function hashToken(token: string) {
  const secret = managementSecret()
  if (!secret) throw new ApiDomainError("INTERNAL_ERROR", "Reservation management is not configured.", false, "contact_support", 503)
  return createHash("sha256").update(`${secret}:${token}`).digest("hex")
}

export type CustomerReservation = {
  id: string
  restaurant_id: string
  reservation_area_id: string | null
  customer_name: string
  customer_phone: string
  customer_email: string | null
  party_size: number
  reservation_date: string
  reservation_time: string
  special_requests: string | null
  reservation_type: string | null
  status: string | null
  restaurant?: { name: string; slug: string }
}

export async function issueCustomerManagementToken(input: { reservationId: string; restaurantId: string; ttlHours?: number }) {
  const raw = `rv_manage_${randomBytes(32).toString("base64url")}`
  const expiresAt = new Date(Date.now() + (input.ttlHours || 72) * 60 * 60 * 1000).toISOString()
  const result = await (createServiceRoleClient() as any).from("reservation_customer_management_tokens").insert({
    reservation_id: input.reservationId,
    restaurant_id: input.restaurantId,
    token_hash: hashToken(raw),
    expires_at: expiresAt,
  }).select("id, expires_at").single()
  if (result.error) throw new Error(result.error.message)
  return { token: raw, expiresAt }
}

export async function resolveCustomerManagementToken(token: string, reservationId?: string) {
  if (!/^rv_manage_[A-Za-z0-9_-]{20,}$/.test(token)) throw new ApiDomainError("FORBIDDEN", "The reservation management token is invalid.", false, "request_management_token", 403)
  const supabase = createServiceRoleClient() as any
  const result = await supabase.from("reservation_customer_management_tokens")
    .select("reservation_id, restaurant_id, expires_at, revoked_at, scopes")
    .eq("token_hash", hashToken(token))
    .maybeSingle()
  if (result.error || !result.data || result.data.revoked_at || new Date(result.data.expires_at).getTime() <= Date.now() || (reservationId && result.data.reservation_id !== reservationId)) {
    throw new ApiDomainError("FORBIDDEN", "The reservation management token is invalid or expired.", false, "request_management_token", 403)
  }
  const reservation = await supabase.from("reservations")
    .select("id, restaurant_id, reservation_area_id, customer_name, customer_phone, customer_email, party_size, reservation_date, reservation_time, special_requests, reservation_type, status, restaurants ( name, slug )")
    .eq("id", result.data.reservation_id)
    .eq("restaurant_id", result.data.restaurant_id)
    .maybeSingle()
  if (reservation.error || !reservation.data) throw new ApiDomainError("RESERVATION_NOT_FOUND", "The reservation could not be found.", false, "check_reservation_id", 404)
  const row = reservation.data as typeof reservation.data & {
    restaurants?: CustomerReservation["restaurant"] | CustomerReservation["restaurant"][] | null
  }
  const restaurant = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants
  return { ...row, restaurant: restaurant || undefined } as CustomerReservation
}

export function getManagementTokenFromRequest(request: Request) {
  const token = request.headers.get("x-reservation-management-token")?.trim()
  if (!token) throw new ApiDomainError("FORBIDDEN", "A reservation management token is required.", false, "send_management_token", 403)
  return token
}
