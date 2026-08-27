"use server"

import { revalidatePath } from "next/cache"
import {
  connectRestaurantDomain,
  domainErrorMessage,
  DomainServiceError,
  refreshRestaurantDomain,
  removeRestaurantDomain,
} from "@/lib/domains/domain-service"

function actionError(error: unknown, action: string, restaurantId: string) {
  const code = error instanceof DomainServiceError ? error.code : "UNKNOWN"
  console.error("Reservevia custom domain action failed", {
    action,
    restaurantId,
    code,
    error: error instanceof Error ? error.message : String(error),
  })
  return { success: false as const, code, message: domainErrorMessage(error) }
}

export async function connectRestaurantDomainAction(restaurantId: string, hostname: string, publicSurface: "restaurant" | "brand" = "restaurant") {
  try {
    const result = await connectRestaurantDomain(restaurantId, hostname, publicSurface)
    revalidatePath("/manage/domains")
    return { success: true, ...result }
  } catch (error) {
    return actionError(error, "connect", restaurantId)
  }
}

export async function refreshRestaurantDomainAction(restaurantId: string) {
  try {
    const result = await refreshRestaurantDomain(restaurantId)
    revalidatePath("/manage/domains")
    return { success: true, ...result }
  } catch (error) {
    return actionError(error, "refresh", restaurantId)
  }
}

export async function removeRestaurantDomainAction(restaurantId: string) {
  try {
    const result = await removeRestaurantDomain(restaurantId)
    revalidatePath("/manage/domains")
    return result.success ? { success: true } : { success: false, code: "PROVIDER" as const, message: "Domain could not be removed." }
  } catch (error) {
    return actionError(error, "remove", restaurantId)
  }
}
