import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"
import { getFeedEligibleRestaurants, toPublicRestaurantDto } from "@/lib/ai/restaurant-directory"
import { createServiceRoleClient } from "@/lib/supabase"

function feedSecret() {
  return process.env.RESERVEVIA_FEED_SECRET || process.env.RESERVEVIA_RATE_LIMIT_SECRET || (process.env.NODE_ENV === "production" ? null : "reservevia-local-feed-secret")
}

function sign(value: string) {
  const secret = feedSecret()
  if (!secret) throw new Error("FEED_SECRET_NOT_CONFIGURED")
  return createHmac("sha256", secret).update(value).digest("base64url")
}

function encodeToken(offset: number, revision: number) {
  const value = JSON.stringify({ offset, revision })
  return `${Buffer.from(value).toString("base64url")}.${sign(value)}`
}

function decodeToken(token: string | null) {
  if (!token) return { offset: 0, revision: null as number | null }
  const [encoded, signature] = token.split(".")
  if (!encoded || !signature) return null
  try {
    const value = Buffer.from(encoded, "base64url").toString("utf8")
    const expected = sign(value)
    if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null
    const parsed = JSON.parse(value)
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0 || !Number.isInteger(parsed.revision)) return null
    return { offset: parsed.offset, revision: parsed.revision }
  } catch {
    return null
  }
}

async function currentRevision() {
  const result = await (createServiceRoleClient() as any).from("ai_business_feed_state").select("revision, last_changed_at").eq("singleton", true).maybeSingle()
  if (result.error || !result.data) throw new Error("FEED_STATE_UNAVAILABLE")
  return result.data as { revision: number; last_changed_at: string }
}

export async function getBusinessFeed(input: { pageSize: number; pageToken?: string | null; changesToken?: string | null }) {
  const state = await currentRevision()
  const page = decodeToken(input.pageToken || null)
  if (!page) throw new Error("INVALID_PAGE_TOKEN")
  if (page.revision !== null && page.revision !== state.revision) throw new Error("STALE_PAGE_TOKEN")
  const change = decodeToken(input.changesToken || null)
  if (input.changesToken && (!change || change.offset !== 0)) throw new Error("INVALID_CHANGES_TOKEN")
  if (input.changesToken && change?.revision === state.revision) {
    return { businesses: [], next_page_token: null, changes_token: encodeToken(0, state.revision), checksum: sign(`checksum:${state.revision}`), last_modified: state.last_changed_at }
  }
  const rows = await getFeedEligibleRestaurants()
  const pageSize = Math.min(Math.max(input.pageSize || 100, 1), 1000)
  const items = rows.slice(page.offset, page.offset + pageSize).map((row) => ({
    id: row.id,
    name: row.name,
    address: {
      line1: row.address_line1 || null,
      line2: row.address_line2 || null,
      locality: row.address_locality || null,
      region: row.address_region || null,
      postal_code: row.address_postal_code || null,
      country: row.address_country || null,
      formatted: [row.address_line1, row.address_line2, row.address_locality, row.address_region, row.address_postal_code, row.address_country].filter(Boolean).join(", ") || row.location || "",
    },
    location: { latitude: row.latitude, longitude: row.longitude },
    phone_number: row.phone ? row.phone.replace(/[^\d+]/g, "") : null,
    website_url: row.official_website_url,
    platform_url: toPublicRestaurantDto(row).platform_url,
  }))
  const nextOffset = page.offset + items.length
  return {
    businesses: items,
    next_page_token: nextOffset < rows.length ? encodeToken(nextOffset, state.revision) : null,
    changes_token: encodeToken(0, state.revision),
    checksum: sign(`checksum:${state.revision}`),
    last_modified: state.last_changed_at,
  }
}
