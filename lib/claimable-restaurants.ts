import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { createServiceRoleClient } from "@/lib/supabase"
import { audit } from "@/lib/platform-audit"

export const CLAIM_TOKEN_EXPIRY_DAYS = 30
export const RESERVATION_MANAGE_TOKEN_EXPIRY_DAYS = 14

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "yahoo.com", "icloud.com", "me.com", "mac.com", "proton.me",
  "protonmail.com", "aol.com",
])

export type ClaimOwnershipStatus = "unclaimed" | "claim_pending" | "claimed"
export type ClaimSource = "platform_manual" | "platform_excel" | "dataengine" | "self_service" | "legacy"

export function isClaimableSource(source: ClaimSource | string | null | undefined) {
  return source === "dataengine" || source === "platform_manual" || source === "platform_excel"
}

export type RestaurantClaimProfile = {
  restaurant_id: string
  ownership_status: ClaimOwnershipStatus
  source: ClaimSource
  business_contact_email: string | null
  normalized_business_contact_email: string | null
  dataengine_batch_id: string | null
  official_website_url: string | null
  official_domain: string | null
  claimed_by_user_id: string | null
  claimed_at: string | null
  source_import_id: string | null
  business_email_delivery_status: "healthy" | "pending" | "hard_bounce" | "paused"
  business_email_last_error: string | null
  business_email_paused_at: string | null
  created_at: string
  updated_at: string
}

export function normalizeBusinessEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null
}

export function getEmailDomain(value: string | null | undefined) {
  const email = normalizeBusinessEmail(value)
  const at = email?.lastIndexOf("@") ?? -1
  return at > 0 ? email!.slice(at + 1) : null
}

export function normalizeOfficialDomain(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
    const url = new URL(candidate)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "")
    if (!hostname || hostname.includes(":")) return null
    return hostname
  } catch {
    return null
  }
}

export function normalizeOfficialWebsiteUrl(value: string | null | undefined) {
  if (!value?.trim()) return null
  try {
    const url = new URL(/^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null
    return url.toString().replace(/\/$/, "")
  } catch {
    return null
  }
}

export function isConsumerEmailDomain(domain: string | null | undefined) {
  const normalized = domain?.trim().toLowerCase() || ""
  return CONSUMER_EMAIL_DOMAINS.has(normalized) || normalized.startsWith("gmx.")
}

export function isEligibleOfficialDomain(email: string | null | undefined, officialDomain: string | null | undefined) {
  const emailDomain = getEmailDomain(email)
  const normalizedOfficialDomain = normalizeOfficialDomain(officialDomain)
  return Boolean(emailDomain && normalizedOfficialDomain && !isConsumerEmailDomain(emailDomain) && emailDomain === normalizedOfficialDomain)
}

export function createClaimToken() {
  return randomBytes(32).toString("base64url")
}

export function hashClaimToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function isClaimToken(value: string | null | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{32,128}$/.test(value))
}

export function createReservationManageToken() {
  return randomBytes(32).toString("base64url")
}

export function hashReservationManageToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function isReservationManageToken(value: string | null | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{32,128}$/.test(value))
}

export function getClaimUrl(restaurantId: string, token?: string | null) {
  const base = `/claim/${encodeURIComponent(restaurantId)}`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

function applicationOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim()
  if (configured) {
    try { return new URL(configured).origin } catch { /* use local fallback */ }
  }
  return "http://localhost:3000"
}

export function getReservationManageUrl(token: string) {
  return `${applicationOrigin()}/reservation/manage/${encodeURIComponent(token)}`
}

export async function getRestaurantClaimProfile(restaurantId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("restaurant_claim_profiles")
    .select("restaurant_id, ownership_status, source, business_contact_email, normalized_business_contact_email, dataengine_batch_id, official_website_url, official_domain, claimed_by_user_id, claimed_at, source_import_id, business_email_delivery_status, business_email_last_error, business_email_paused_at, created_at, updated_at")
    .eq("restaurant_id", restaurantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as RestaurantClaimProfile | null
}

export async function getPublicRestaurantClaimState(restaurantId: string) {
  const service = createServiceRoleClient()
  const [{ data: restaurant, error: restaurantError }, profile] = await Promise.all([
    service.from("restaurants").select("id, name, slug, status, platform_status, workspace_id").eq("id", restaurantId).maybeSingle(),
    getRestaurantClaimProfile(restaurantId),
  ])
  if (restaurantError) throw new Error(restaurantError.message)
  const claimable = Boolean(
    restaurant && profile && isClaimableSource(profile.source) &&
    (profile.ownership_status === "unclaimed" || profile.ownership_status === "claim_pending")
  )
  return {
    restaurant,
    isClaimable: claimable,
    ownershipStatus: claimable ? profile?.ownership_status || "unclaimed" : "claimed",
  }
}

export async function createBusinessReservationAccess(input: {
  restaurantId: string
  reservationId: string
  businessEmail: string
  actorUserId?: string | null
}) {
  const service = createServiceRoleClient()
  const claimToken = createClaimToken()
  const manageToken = createReservationManageToken()
  const claimExpiresAt = new Date(Date.now() + CLAIM_TOKEN_EXPIRY_DAYS * 86400000).toISOString()
  const manageExpiresAt = new Date(Date.now() + RESERVATION_MANAGE_TOKEN_EXPIRY_DAYS * 86400000).toISOString()

  const { error } = await service.rpc("create_reservation_access_records", {
    target_restaurant_id: input.restaurantId,
    target_reservation_id: input.reservationId,
    target_business_email: normalizeBusinessEmail(input.businessEmail),
    target_claim_token_hash: hashClaimToken(claimToken),
    target_claim_expires_at: claimExpiresAt,
    target_manage_token_hash: hashReservationManageToken(manageToken),
    target_manage_expires_at: manageExpiresAt,
  } as any)
  if (error) throw new Error(error.message)

  return {
    claimUrl: `${applicationOrigin()}${getClaimUrl(input.restaurantId, claimToken)}`,
    manageUrl: getReservationManageUrl(manageToken),
  }
}

export async function resolveClaimToken(restaurantId: string, rawToken: string) {
  if (!isClaimToken(rawToken)) return null
  const { data, error } = await createServiceRoleClient()
    .from("restaurant_claims")
    .select("id, restaurant_id, reservation_id, requested_email, status, expires_at")
    .eq("restaurant_id", restaurantId)
    .eq("token_hash", hashClaimToken(rawToken))
    .in("status", ["pending", "verified", "approved"])
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function evaluateClaimForUser(restaurantId: string, userId: string, token?: string | null) {
  const service = createServiceRoleClient()
  const [{ data: userResult, error: userError }, profile] = await Promise.all([
    service.auth.admin.getUserById(userId),
    getRestaurantClaimProfile(restaurantId),
  ])
  if (userError || !userResult.user) return { eligible: false as const, reason: "user_not_found" as const }
  const user = userResult.user
  const verifiedEmail = normalizeBusinessEmail(user.email)
  if (!verifiedEmail || !user.email_confirmed_at) return { eligible: false as const, reason: "email_not_verified" as const, email: verifiedEmail }
  if (!profile || !isClaimableSource(profile.source) || profile.ownership_status === "claimed") {
    return { eligible: false as const, reason: "not_claimable" as const, email: verifiedEmail }
  }

  const tokenRow = token && isClaimToken(token) ? await resolveClaimToken(restaurantId, token) : null
  const exactEmail = Boolean(profile.normalized_business_contact_email && verifiedEmail === profile.normalized_business_contact_email)
  if (exactEmail) return { eligible: true as const, method: "exact_email" as const, email: verifiedEmail, tokenRow }

  const domain = getEmailDomain(verifiedEmail)
  const officialDomain = normalizeOfficialDomain(profile.official_domain)
  if (domain && officialDomain && !isConsumerEmailDomain(domain) && domain === officialDomain) {
    const { count, error } = await service
      .from("restaurant_claim_profiles")
      .select("restaurant_id", { count: "exact", head: true })
      .eq("official_domain", officialDomain)
      .in("ownership_status", ["unclaimed", "claim_pending"])
    if (error) throw new Error(error.message)
    if ((count || 0) === 1) return { eligible: true as const, method: "official_domain" as const, email: verifiedEmail, tokenRow }
    return { eligible: false as const, reason: "shared_domain_manual_review" as const, email: verifiedEmail, tokenRow }
  }

  return { eligible: false as const, reason: tokenRow ? "manual_review" as const : "email_mismatch" as const, email: verifiedEmail, tokenRow }
}

export async function completeClaimForUser(input: {
  restaurantId: string
  userId: string
  token?: string | null
  auditAction?: string
}) {
  const existingProfile = await getRestaurantClaimProfile(input.restaurantId)
  if (existingProfile?.ownership_status === "claimed" && existingProfile.claimed_by_user_id === input.userId) {
    return { success: true as const, status: "claimed" as const, method: "idempotent" as const }
  }
  const evaluation = await evaluateClaimForUser(input.restaurantId, input.userId, input.token)
  if (!evaluation.eligible) {
    if (evaluation.reason !== "not_claimable" && evaluation.email) {
      const { data: request, error: requestError } = await createServiceRoleClient().from("restaurant_claims").insert({
        restaurant_id: input.restaurantId,
        claimant_user_id: input.userId,
        requested_email: evaluation.email,
        verified_email: evaluation.email,
        verification_method: evaluation.reason === "shared_domain_manual_review" ? "manual_review" : "token",
        status: "pending",
        expires_at: new Date(Date.now() + CLAIM_TOKEN_EXPIRY_DAYS * 86400000).toISOString(),
        metadata: { reason: evaluation.reason },
      }).select("id").single()
      if (requestError) throw new Error(requestError.message)
      const { error: profileError } = await createServiceRoleClient()
        .from("restaurant_claim_profiles")
        .update({ ownership_status: "claim_pending" })
        .eq("restaurant_id", input.restaurantId)
        .in("ownership_status", ["unclaimed", "claim_pending"])
      if (profileError) throw new Error(profileError.message)
      await audit({
        actorUserId: input.userId,
        action: "restaurant.claim_requested",
        entityType: "restaurant_claim",
        entityId: request.id,
        after: { restaurantId: input.restaurantId, status: "pending", reason: evaluation.reason },
      })
    }
    return { success: false as const, status: evaluation.reason }
  }

  const { data, error } = await createServiceRoleClient().rpc("complete_restaurant_claim", {
    target_restaurant_id: input.restaurantId,
    target_user_id: input.userId,
    target_verified_email: evaluation.email,
    target_verification_method: evaluation.method,
  })
  if (error) throw new Error(error.message)
  const claimed = Array.isArray(data) ? data[0] : data
  if (!claimed) throw new Error("Claim completion did not return a restaurant.")

  if (input.auditAction && !input.auditAction.includes("token")) {
    await audit({
      actorUserId: input.userId,
      action: input.auditAction,
      entityType: "restaurant",
      entityId: input.restaurantId,
      after: { ownershipStatus: "claimed", verificationMethod: evaluation.method },
    })
  }
  return { success: true as const, status: "claimed" as const, method: evaluation.method, data: claimed }
}
