"use client"

import type { Database } from "@/types/supabase"

export type ManageCachedReservation = Database["public"]["Tables"]["reservations"]["Row"] & {
  restaurants?: { id: string; name: string } | null
  reservation_areas?: { id: string; name: string } | null
  booked_by_email?: string | null
  booked_by_label?: string | null
  booked_by_name?: string | null
}

export type ManageCachedRestaurant = { id: string; name: string; meal_only_reservations?: boolean }
export type ManageOfflineCache = { syncedAt: string; reservations: ManageCachedReservation[]; restaurants: ManageCachedRestaurant[] }

const CACHE_PREFIX = "reservevia:manage-cache:v2"
const CACHE_TTL_MS = 10 * 60 * 1000
let activeCacheScope: string | null = null

/**
 * Keep a short-lived, tab-scoped cache for fast route transitions. The key is
 * bound to the authenticated user and workspace so another account cannot
 * receive the previous account's management data in the same tab.
 */
export function setManageOfflineCacheScope(scope: string | null) {
  activeCacheScope = scope
}

function cacheKey() {
  return activeCacheScope ? `${CACHE_PREFIX}:${encodeURIComponent(activeCacheScope)}` : null
}
export function getManageOfflineRange(date = new Date()) {
  const format = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 7)
  return { startDate: format(start), endDate: format(end) }
}

export function isReservationInManageOfflineRange() { return false }
export function filterReservationsForManageOfflineRange<T extends { reservation_date?: string | null }>(reservations: T[]) { void reservations; return [] as T[] }
export function readManageOfflineCache(): ManageOfflineCache | null {
  const key = cacheKey()
  if (!key || typeof window === "undefined") return null

  try {
    const raw = window.sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as ManageOfflineCache
    if (!parsed?.syncedAt || Date.now() - new Date(parsed.syncedAt).getTime() > CACHE_TTL_MS) {
      window.sessionStorage.removeItem(key)
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function writeManageOfflineCache(input?: { reservations: ManageCachedReservation[]; restaurants: ManageCachedRestaurant[] }): ManageOfflineCache | null {
  const key = cacheKey()
  if (!key || typeof window === "undefined" || !input) return null

  const next: ManageOfflineCache = {
    syncedAt: new Date().toISOString(),
    reservations: input.reservations,
    restaurants: input.restaurants,
  }
  try {
    window.sessionStorage.setItem(key, JSON.stringify(next))
    return next
  } catch {
    return null
  }
}
