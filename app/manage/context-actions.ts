"use server"

import { cookies } from "next/headers"
import { requireRestaurantAccess, requireWorkspaceAccess } from "@/lib/authorization"
import { getWorkspaceUsage } from "@/lib/entitlements"
import { ACTIVE_RESTAURANT_COOKIE } from "@/lib/management-context"

export async function selectWorkspace(workspaceId: string) {
  await requireWorkspaceAccess(workspaceId)
  const cookieStore = await cookies()
  cookieStore.set("reservevia_workspace_id", workspaceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" })
  cookieStore.delete(ACTIVE_RESTAURANT_COOKIE)
  return { success: true }
}

export async function selectRestaurant(restaurantId: string) {
  if (restaurantId === "all" || !restaurantId) {
    const cookieStore = await cookies()
    cookieStore.set(ACTIVE_RESTAURANT_COOKIE, "all", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" })
    return { success: true }
  }
  await requireRestaurantAccess(restaurantId)
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_RESTAURANT_COOKIE, restaurantId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" })
  return { success: true }
}

export async function getManagementUsage(workspaceId: string) {
  try {
    await requireWorkspaceAccess(workspaceId)
    const usage = await getWorkspaceUsage(workspaceId)
    return {
      success: true,
      data: {
        restaurants: usage.restaurants,
        users: usage.users,
        reservationsCreated: usage.reservationsCreated,
        periodStart: usage.periodStart,
        periodEnd: usage.periodEnd,
      },
    }
  } catch {
    return { success: false, data: null }
  }
}
