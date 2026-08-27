"use server"

import { revalidatePath } from "next/cache"
import { getCurrentWorkspace } from "@/lib/authorization"
import { can } from "@/lib/entitlements"
import { getManagementContext } from "@/lib/management-context"
import { buildEffectivePwaBranding, storagePathFromPublicUrl, type EffectivePwaBranding } from "@/lib/pwa"
import { isWebPushConfigured } from "@/lib/push-service"
import { createServiceRoleClient } from "@/lib/supabase"

const MAX_ICON_SIZE = 2 * 1024 * 1024
const ALLOWED_ICON_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"])

export type PwaManagementData = {
  workspace: { id: string; name: string }
  role: string
  customPWA: boolean
  pushNotifications: boolean
  planName: string
  branding: EffectivePwaBranding
  settings: { app_name: string | null; icon_url: string | null; theme_color: string; background_color: string } | null
  pushConfigured: boolean
}

export type PwaManagementResult =
  | { success: true; data: PwaManagementData }
  | { success: false; message: string }

function cleanColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

function cleanAppName(value: unknown) {
  if (typeof value !== "string") return null
  const name = value.trim()
  if (!name) return null
  if (name.length > 60) throw new Error("App name must be 60 characters or fewer.")
  return name
}

async function requirePwaAdmin() {
  const current = await getCurrentWorkspace()
  if (!current) throw new Error("Workspace access is required.")
  if (!['owner', 'admin'].includes(current.role)) throw new Error("Only workspace owners and admins can manage PWA branding.")
  if (!(await can(current.workspace_id, "customPWA"))) throw new Error("Custom PWA branding is available on Pro and Business plans.")
  return current
}

export async function getPwaManagementData(): Promise<PwaManagementResult> {
  try {
    const managementContext = await getManagementContext()
    const currentWorkspace = managementContext?.currentWorkspace
    if (!currentWorkspace) return { success: false, message: "Workspace access is required." }

    const settings = await Promise.all([
      createServiceRoleClient()
        .from("workspace_pwa_settings")
        .select("app_name, icon_url, theme_color, background_color")
        .eq("workspace_id", currentWorkspace.id)
        .maybeSingle(),
    ]).then(([result]) => result)

    if (settings.error) throw new Error(settings.error.message)
    const branding = buildEffectivePwaBranding({
      workspaceId: currentWorkspace.id,
      workspaceName: currentWorkspace.workspace?.name,
      restaurantId: managementContext.activeRestaurantId,
      restaurants: managementContext.restaurants,
      settings: settings.data,
      customBrandingEnabled: currentWorkspace.customPwaEnabled,
    })
    return {
      success: true,
      data: {
        workspace: { id: currentWorkspace.id, name: currentWorkspace.workspace?.name || "Workspace" },
        role: currentWorkspace.role,
        customPWA: currentWorkspace.customPwaEnabled,
        pushNotifications: currentWorkspace.pushNotificationsEnabled,
        planName: currentWorkspace.plan?.name || "Workspace plan",
        branding,
        settings: settings.data,
        pushConfigured: isWebPushConfigured(),
      },
    }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "PWA settings could not be loaded." }
  }
}

export async function savePwaSettings(input: { appName?: string; themeColor?: string; backgroundColor?: string }) {
  try {
    const current = await requirePwaAdmin()
    const appName = cleanAppName(input.appName)
    const themeColor = cleanColor(input.themeColor, "#1e40af")
    const backgroundColor = cleanColor(input.backgroundColor, "#ffffff")
    const supabase = createServiceRoleClient()
    const { error } = await supabase.from("workspace_pwa_settings").upsert({
      workspace_id: current.workspace_id,
      app_name: appName,
      theme_color: themeColor,
      background_color: backgroundColor,
      updated_by: current.user_id,
    }, { onConflict: "workspace_id" })
    if (error) throw new Error(error.message)
    revalidatePath("/manage/pwa")
    return { success: true, message: "PWA branding saved." }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "PWA branding could not be saved." }
  }
}

function hasImageSignature(bytes: Uint8Array) {
  const startsWith = (...values: number[]) => values.every((value, index) => bytes[index] === value)
  const isPng = startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const isJpeg = startsWith(0xff, 0xd8, 0xff)
  const isGif = startsWith(0x47, 0x49, 0x46, 0x38)
  const isWebp = startsWith(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  const isAvif = bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 12)).includes("ftyp")
  return isPng || isJpeg || isGif || isWebp || isAvif
}

export async function uploadPwaIcon(formData: FormData) {
  try {
    const current = await requirePwaAdmin()
    const file = formData.get("icon")
    if (!(file instanceof File) || file.size === 0) throw new Error("Choose an image to upload.")
    if (!ALLOWED_ICON_TYPES.has(file.type) || file.size > MAX_ICON_SIZE) throw new Error("Use a JPG, PNG, WebP, GIF, or AVIF image up to 2 MB.")
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!hasImageSignature(bytes)) throw new Error("The selected file is not a valid image.")

    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png"
    const path = `${current.workspace_id}/pwa/icon/${crypto.randomUUID()}.${extension}`
    const supabase = createServiceRoleClient()
    const upload = await supabase.storage.from("restaurant-assets").upload(path, Buffer.from(bytes), {
      cacheControl: "31536000",
      contentType: file.type,
      upsert: false,
    })
    if (upload.error) throw new Error(upload.error.message)

    const publicUrl = supabase.storage.from("restaurant-assets").getPublicUrl(path).data.publicUrl
    const { data: previous } = await supabase
      .from("workspace_pwa_settings")
      .select("icon_url")
      .eq("workspace_id", current.workspace_id)
      .maybeSingle()
    const { error } = await supabase.from("workspace_pwa_settings").upsert({
      workspace_id: current.workspace_id,
      icon_url: publicUrl,
      updated_by: current.user_id,
    }, { onConflict: "workspace_id" })
    if (error) {
      await supabase.storage.from("restaurant-assets").remove([path])
      throw new Error(error.message)
    }

    const previousPath = storagePathFromPublicUrl(previous?.icon_url)
    if (previousPath && previousPath.startsWith(`${current.workspace_id}/pwa/icon/`)) {
      await supabase.storage.from("restaurant-assets").remove([previousPath])
    }
    revalidatePath("/manage/pwa")
    return { success: true, message: "PWA icon updated." }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "PWA icon could not be uploaded." }
  }
}

export async function removePwaIcon() {
  try {
    const current = await requirePwaAdmin()
    const supabase = createServiceRoleClient()
    const { data: settings } = await supabase
      .from("workspace_pwa_settings")
      .select("icon_url")
      .eq("workspace_id", current.workspace_id)
      .maybeSingle()
    const { error } = await supabase
      .from("workspace_pwa_settings")
      .update({ icon_url: null, updated_by: current.user_id })
      .eq("workspace_id", current.workspace_id)
    if (error) throw new Error(error.message)
    const path = storagePathFromPublicUrl(settings?.icon_url)
    if (path?.startsWith(`${current.workspace_id}/pwa/icon/`)) {
      await supabase.storage.from("restaurant-assets").remove([path])
    }
    revalidatePath("/manage/pwa")
    return { success: true, message: "PWA icon reset to the workspace default." }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : "PWA icon could not be removed." }
  }
}
