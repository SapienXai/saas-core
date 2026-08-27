"use server"

import { revalidatePath } from "next/cache"
import { connectWorkspaceDomain, domainErrorMessage, DomainServiceError, refreshWorkspaceDomain, removeWorkspaceDomain } from "@/lib/domains/domain-service"

function actionError(error: unknown, action: string) {
  const code = error instanceof DomainServiceError ? error.code : "UNKNOWN"
  console.error("Custom domain action failed", {
    action,
    code,
    error: error instanceof Error ? error.message : String(error),
  })
  return { success: false as const, code, message: domainErrorMessage(error) }
}

export async function connectWorkspaceDomainAction(hostname: string) {
  try {
    const result = await connectWorkspaceDomain(hostname)
    revalidatePath("/manage/domains")
    return { success: true, ...result }
  } catch (error) {
    return actionError(error, "connect")
  }
}

export async function refreshWorkspaceDomainAction() {
  try {
    const result = await refreshWorkspaceDomain()
    revalidatePath("/manage/domains")
    return { success: true, ...result }
  } catch (error) {
    return actionError(error, "refresh")
  }
}

export async function removeWorkspaceDomainAction() {
  try {
    const result = await removeWorkspaceDomain()
    revalidatePath("/manage/domains")
    return result.success ? { success: true } : { success: false, code: "PROVIDER" as const, message: "Domain could not be removed." }
  } catch (error) {
    return actionError(error, "remove")
  }
}
