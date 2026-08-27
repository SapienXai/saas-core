"use server"

import { revalidatePath } from "next/cache"
import {
  createSubscriptionOverride,
  approvePlatformRestaurantClaim,
  confirmPlatformRestaurantImport,
  createPlatformRestaurant,
  previewPlatformRestaurantWebsite as runPreviewPlatformRestaurantWebsite,
  previewPlatformRestaurantImport,
  rejectPlatformRestaurantClaim,
  revokeSubscriptionOverride,
  setPlatformRestaurantStatus,
  setPlatformUserStatus,
  setPlatformWorkspaceStatus,
  syncPlatformRestaurantWebsiteAssets,
  updatePlanCatalog,
  updatePlatformMember,
  updatePlatformSetting,
  issuePlatformApiClient,
  type PlatformRestaurantImportMode,
} from "@/lib/platform-admin"
import { refreshPlatformDomain } from "@/lib/platform-operations"
import { correctPlatformDataEngineBusinessEmail, overridePlatformDataEngineLeadReadiness, preparePlatformDataEngineLeadBanner, retryPlatformDataEngineEmail, retryPlatformDataEngineLeadPublish, reviewPlatformDataEngineLeads } from "@/lib/platform-dataengine"

function resultError(error: unknown) {
  return error instanceof Error ? error.message : "Platform action could not be completed."
}

export async function prepareDataEngineLeadBannerAction(leadId: string, reason: string) {
  try {
    const result = await preparePlatformDataEngineLeadBanner(leadId, reason)
    revalidatePath("/platform/dataengine")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function reviewDataEngineLeadsAction(input: Parameters<typeof reviewPlatformDataEngineLeads>[0]) {
  try {
    const result = await reviewPlatformDataEngineLeads(input)
    revalidatePath("/platform/dataengine")
    revalidatePath(`/platform/dataengine/${input.batchId}`)
    revalidatePath("/platform/restaurants")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function retryDataEngineLeadPublishAction(leadId: string, reason: string) {
  try {
    const result = await retryPlatformDataEngineLeadPublish(leadId, reason)
    revalidatePath("/platform/dataengine")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function overrideDataEngineLeadReadinessAction(input: Parameters<typeof overridePlatformDataEngineLeadReadiness>[0]) {
  try {
    const result = await overridePlatformDataEngineLeadReadiness(input)
    revalidatePath("/platform/dataengine")
    revalidatePath(`/platform/dataengine/${input.batchId}`)
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function retryDataEngineEmailAction(eventId: string, reason: string) {
  try {
    const result = await retryPlatformDataEngineEmail(eventId, reason)
    revalidatePath("/platform/dataengine")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function correctDataEngineBusinessEmailAction(input: Parameters<typeof correctPlatformDataEngineBusinessEmail>[0]) {
  try {
    const result = await correctPlatformDataEngineBusinessEmail(input)
    revalidatePath("/platform/dataengine")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function issuePlatformApiClientAction(input: Parameters<typeof issuePlatformApiClient>[0]) {
  try {
    return { success: true as const, ...(await issuePlatformApiClient(input)) }
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function changePlatformUserStatus(userId: string, status: "active" | "suspended", reason?: string) {
  try {
    const result = await setPlatformUserStatus(userId, status, reason)
    revalidatePath("/platform")
    revalidatePath("/platform/users")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function changePlatformWorkspaceStatus(workspaceId: string, status: string, reason?: string) {
  try {
    const result = await setPlatformWorkspaceStatus(workspaceId, status, reason)
    revalidatePath("/platform")
    revalidatePath("/platform/workspaces")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function changePlatformRestaurantStatus(restaurantId: string, status: string, reason?: string) {
  try {
    const result = await setPlatformRestaurantStatus(restaurantId, status, reason)
    revalidatePath("/platform")
    revalidatePath("/platform/restaurants")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function addSubscriptionOverride(input: Parameters<typeof createSubscriptionOverride>[0]) {
  try {
    const result = await createSubscriptionOverride(input)
    revalidatePath("/platform")
    revalidatePath("/platform/workspaces")
    revalidatePath("/platform/billing")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function removeSubscriptionOverride(overrideId: string, reason: string) {
  try {
    const result = await revokeSubscriptionOverride(overrideId, reason)
    revalidatePath("/platform")
    revalidatePath("/platform/workspaces")
    revalidatePath("/platform/billing")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function savePlatformPlan(input: Parameters<typeof updatePlanCatalog>[0]) {
  try {
    const result = await updatePlanCatalog(input)
    revalidatePath("/platform")
    revalidatePath("/platform/billing")
    revalidatePath("/pricing")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function savePlatformSetting(key: string, value: unknown, reason: string) {
  try {
    const result = await updatePlatformSetting(key, value, reason)
    revalidatePath("/platform")
    revalidatePath("/platform/settings")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function savePlatformMember(input: Parameters<typeof updatePlatformMember>[0]) {
  try {
    const result = await updatePlatformMember(input)
    revalidatePath("/platform")
    revalidatePath("/platform/team")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function recheckPlatformDomain(domainId: string, reason?: string) {
  try {
    const result = await refreshPlatformDomain(domainId, reason)
    revalidatePath("/platform")
    revalidatePath("/platform/alerts")
    revalidatePath("/platform/domains")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function addPlatformRestaurant(input: Parameters<typeof createPlatformRestaurant>[0]) {
  try {
    const result = await createPlatformRestaurant(input)
    revalidatePath("/platform/restaurants")
    revalidatePath(`/platform/restaurants/${result.restaurantId}`)
    revalidatePath("/r/[slug]", "page")
    return result
  } catch (error) {
    return { success: false, message: resultError(error) }
  }
}

export async function previewPlatformRestaurantWebsiteAction(input: { websiteUrl: string }) {
  try {
    const result = await runPreviewPlatformRestaurantWebsite(input)
    return { success: true as const, data: result }
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function previewPlatformRestaurantImportAction(input: FormData) {
  try {
    const file = input.get("file")
    if (!(file instanceof File)) return { success: false as const, message: "Choose an .xlsx file first." }
    const mode: PlatformRestaurantImportMode = input.get("mode") === "update" ? "update" : "create"
    const result = await previewPlatformRestaurantImport({ filename: file.name, buffer: Buffer.from(await file.arrayBuffer()), mode })
    return { success: true as const, ...result }
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function confirmPlatformRestaurantImportAction(batchId: string) {
  try {
    const result = await confirmPlatformRestaurantImport(batchId)
    revalidatePath("/platform/restaurants")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function syncPlatformRestaurantWebsiteAssetsAction(restaurantIds: string[]) {
  try {
    const result = await syncPlatformRestaurantWebsiteAssets(restaurantIds)
    revalidatePath("/platform/restaurants")
    for (const restaurantId of restaurantIds) revalidatePath(`/platform/restaurants/${restaurantId}`)
    revalidatePath("/r/[slug]", "page")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function approvePlatformRestaurantClaimAction(claimId: string, reason: string) {
  try {
    const result = await approvePlatformRestaurantClaim(claimId, reason)
    revalidatePath("/platform/restaurants")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}

export async function rejectPlatformRestaurantClaimAction(claimId: string, reason: string) {
  try {
    const result = await rejectPlatformRestaurantClaim(claimId, reason)
    revalidatePath("/platform/restaurants")
    return result
  } catch (error) {
    return { success: false as const, message: resultError(error) }
  }
}
