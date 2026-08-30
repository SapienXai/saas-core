"use server"

import { revalidatePath } from "next/cache"
import { createPlatformUser, createPlatformUserRecoveryLink, deletePlatformUser, bulkDeletePlatformUsers, bulkSetPlatformUserStatus, resendPlatformUserInvite, updatePlatformUser } from "@/lib/platform-admin"

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function done(result: Awaited<ReturnType<typeof createPlatformUser>>) {
  if (result.success) revalidatePath("/platform/users")
  return result
}

export async function createPlatformUserAction(formData: FormData) {
  return done(await createPlatformUser({ email: text(formData, "email"), name: text(formData, "name"), role: text(formData, "role"), status: text(formData, "status") === "suspended" ? "suspended" : "active", password: text(formData, "password"), reason: text(formData, "reason") }))
}

export async function updatePlatformUserAction(formData: FormData) {
  return done(await updatePlatformUser({ userId: text(formData, "userId"), email: text(formData, "email"), name: text(formData, "name"), role: text(formData, "role"), status: text(formData, "status") === "suspended" ? "suspended" : "active", reason: text(formData, "reason") }))
}

export async function deletePlatformUserAction(formData: FormData) {
  return done(await deletePlatformUser(text(formData, "userId"), text(formData, "reason")))
}

export async function bulkSetPlatformUserStatusAction(formData: FormData) {
  return done(await bulkSetPlatformUserStatus(formData.getAll("userId").filter((value): value is string => typeof value === "string"), text(formData, "status") === "suspended" ? "suspended" : "active", text(formData, "reason")))
}

export async function bulkDeletePlatformUsersAction(formData: FormData) {
  return done(await bulkDeletePlatformUsers(formData.getAll("userId").filter((value): value is string => typeof value === "string"), text(formData, "reason")))
}

export async function createPlatformUserRecoveryLinkAction(formData: FormData) {
  return createPlatformUserRecoveryLink(text(formData, "userId"))
}

export async function resendPlatformUserInviteAction(formData: FormData) {
  return done(await resendPlatformUserInvite(text(formData, "userId")))
}
