"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { getAccountState } from "@/lib/account-state"
import { AuthorizationError, requireRestaurantManagementAccess } from "@/lib/authorization"
import { createRestaurant, updateRestaurantProfile } from "@/app/manage/actions"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { importRestaurantFromWebsite as runWebsiteImport, type WebsiteImportResult } from "@/lib/website-import"
import { normalizeOfficialWebsiteUrl } from "@/lib/claimable-restaurants"
import { validateOptionalPublicUrl, validateRestaurantSlug, validateSocialLinks, slugifyRestaurantName, type RestaurantProfileInput } from "@/lib/restaurant-profile"

type BootstrapInput = {
  restaurantName: string
  workspaceName?: string
  restaurantSlug?: string
  workspaceId?: string
}

export async function importRestaurantFromWebsite(input: { websiteUrl: string }): Promise<{ success: boolean; data?: WebsiteImportResult; message?: string }> {
  const state = await getAccountState()
  if (!state.authenticated) return { success: false, message: "Please sign in to continue." }

  try {
    const data = await runWebsiteImport(input.websiteUrl)
    return { success: true, data }
  } catch (error) {
    console.error("[onboarding.importRestaurantFromWebsite] failed", error)
    const message = error instanceof Error ? error.message : "Could not read that website."
    return { success: false, message }
  }
}

export async function bootstrapOnboarding(input: BootstrapInput) {
  const restaurantName = input.restaurantName.trim()
  if (!restaurantName) return { success: false, message: "Restaurant name is required." }
  const slug = (input.restaurantSlug?.trim().toLowerCase() || slugifyRestaurantName(restaurantName)).trim()
  const slugError = validateRestaurantSlug(slug)
  if (slugError) return { success: false, message: slugError }

  const state = await getAccountState()
  if (!state.authenticated) return { success: false, message: "Please sign in to continue." }

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc("bootstrap_initial_workspace", {
    target_restaurant_name: restaurantName,
    target_workspace_name: input.workspaceName?.trim() || null,
    target_restaurant_slug: slug,
  })

  if (error || !data?.[0]) {
    const message = error?.message || "Could not start your restaurant setup."
    if (message.includes("SLUG_RESERVED")) return { success: false, message: "That public slug is reserved by Reservevia." }
    if (message.includes("SELF_SERVICE_WORKSPACE_EXISTS")) return { success: false, message: "Your first workspace already exists. Continue its setup instead." }
    if (message.includes("INVALID_RESTAURANT_NAME")) return { success: false, message: "Enter a restaurant name up to 120 characters." }
    if (error?.code === "23505" && /restaurants_name_key/i.test(message)) {
      return { success: false, message: "That restaurant name is already in use. Try a slightly different display name." }
    }
    return { success: false, message: "Could not start your restaurant setup. Please try again." }
  }

  const cookieStore = await cookies()
  cookieStore.set("reservevia_workspace_id", data[0].workspace_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 90,
    path: "/",
  })
  cookieStore.delete("reservevia_restaurant_id")

  return { success: true, data: data[0] }
}

export async function createAdditionalRestaurant(input: BootstrapInput) {
  const restaurantName = input.restaurantName.trim()
  if (!restaurantName) return { success: false, message: "Restaurant name is required." }

  try {
    const result = await createRestaurant({
      name: restaurantName,
      slug: input.restaurantSlug,
      workspaceId: input.workspaceId,
    })
    if (!result.success || !result.data) {
      const failure = result as { message?: string; code?: string; suggestedSlug?: string }
      return {
        success: false,
        message: failure.message || "Could not create your restaurant.",
        ...(failure.code ? { code: failure.code } : {}),
        ...(failure.suggestedSlug ? { suggestedSlug: failure.suggestedSlug } : {}),
      }
    }
    return {
      success: true,
      data: {
        restaurant_id: result.data.id,
        workspace_id: result.data.workspace_id,
        restaurant_slug: result.data.slug,
      },
    }
  } catch (error) {
    console.error("[onboarding.createAdditionalRestaurant] failed", error)
    return { success: false, message: "Could not create your restaurant. Please try again." }
  }
}

function validateProfileInput(input: RestaurantProfileInput) {
  const slugError = validateRestaurantSlug(input.slug || "")
  if (slugError) return slugError
  for (const [value, label] of [[input.menu_url, "Menu URL"], [input.location_url, "Location URL"], [input.events_url, "Events URL"]] as const) {
    const error = validateOptionalPublicUrl(value, label)
    if (error) return error
  }
  const socialLinksError = validateSocialLinks(input.social_links)
  if (socialLinksError) return socialLinksError
  if (input.official_website_url?.trim() && !normalizeOfficialWebsiteUrl(input.official_website_url)) return "Official website must be a valid http(s) URL."
  if ((input.latitude == null) !== (input.longitude == null)) return "Latitude and longitude must be provided together."
  if (input.latitude != null && (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) return "Latitude must be between -90 and 90."
  if (input.longitude != null && (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)) return "Longitude must be between -180 and 180."
  return null
}

export async function saveOnboardingProfile(restaurantId: string, input: RestaurantProfileInput) {
  const state = await getAccountState()
  if (!state.authenticated || state.restaurantId !== restaurantId) return { success: false, message: "Your setup session is no longer available." }
  const validationError = validateProfileInput(input)
  if (validationError) return { success: false, message: validationError }
  return updateRestaurantProfile(restaurantId, { ...input, status: "unpublished" })
}

export async function saveManagedOnboardingProfile(restaurantId: string, input: RestaurantProfileInput) {
  try {
    await requireRestaurantManagementAccess(restaurantId, ["owner", "admin"])
    const validationError = validateProfileInput(input)
    if (validationError) return { success: false, message: validationError }
    return updateRestaurantProfile(restaurantId, { ...input, status: "unpublished" })
  } catch (error) {
    if (error instanceof AuthorizationError) return { success: false, message: error.message }
    console.error("[onboarding.saveManagedOnboardingProfile] failed", error)
    return { success: false, message: "Could not save your restaurant profile." }
  }
}

export async function publishOnboardingRestaurant(restaurantId: string) {
  try {
    const access = await requireRestaurantManagementAccess(restaurantId, ["owner"])
    const service = createServiceRoleClient()
    const { data: restaurant } = await service.from("restaurants").select("id, workspace_id, slug").eq("id", restaurantId).maybeSingle()
    if (!restaurant?.workspace_id || restaurant.workspace_id !== access.membership?.workspace_id) {
      return { success: false, message: "You do not have permission to publish this restaurant." }
    }

    const { data: workspace } = await service.from("workspaces").select("id, created_by").eq("id", restaurant.workspace_id).maybeSingle()
    if (!workspace || workspace.created_by !== access.access.userId) return { success: false, message: "Only the workspace owner can finish initial setup." }

    const now = new Date().toISOString()
    const { error: restaurantError } = await service.from("restaurants").update({ status: "published", updated_at: now }).eq("id", restaurantId).eq("workspace_id", workspace.id)
    if (restaurantError) return { success: false, message: "Could not publish your restaurant yet." }
    const { error: workspaceError } = await service.from("workspaces").update({ onboarding_completed_at: now, updated_at: now }).eq("id", workspace.id).eq("created_by", access.access.userId)
    if (workspaceError) return { success: false, message: "Your restaurant was saved, but setup is not finished yet. Please try again." }

    revalidatePath("/")
    revalidatePath(`/r/${restaurant.slug}`)
    revalidatePath("/onboarding")
    revalidatePath("/manage")
    return { success: true, slug: restaurant.slug }
  } catch (error) {
    if (error instanceof AuthorizationError) return { success: false, message: error.message }
    console.error("[onboarding.publish] failed", {
      restaurantId,
      error: error instanceof Error ? error.message : String(error),
    })
    return { success: false, message: "Could not publish your restaurant yet. Please refresh and try again." }
  }
}

export async function publishManagedOnboardingRestaurant(restaurantId: string) {
  try {
    const access = await requireRestaurantManagementAccess(restaurantId, ["owner", "admin"])
    const service = createServiceRoleClient()
    const { data: restaurant } = await service.from("restaurants").select("id, workspace_id, slug").eq("id", restaurantId).maybeSingle()
    if (!restaurant?.workspace_id || restaurant.workspace_id !== access.membership?.workspace_id) {
      return { success: false, message: "You do not have permission to publish this restaurant." }
    }

    const { error } = await service
      .from("restaurants")
      .update({ status: "published", updated_at: new Date().toISOString() })
      .eq("id", restaurantId)
      .eq("workspace_id", restaurant.workspace_id)
    if (error) return { success: false, message: "Could not publish your restaurant yet." }

    revalidatePath("/")
    revalidatePath(`/r/${restaurant.slug}`)
    revalidatePath("/manage")
    revalidatePath("/manage/restaurants")
    return { success: true, slug: restaurant.slug }
  } catch (error) {
    if (error instanceof AuthorizationError) return { success: false, message: error.message }
    console.error("[onboarding.publishManagedRestaurant] failed", error)
    return { success: false, message: "Could not publish your restaurant yet. Please try again." }
  }
}
