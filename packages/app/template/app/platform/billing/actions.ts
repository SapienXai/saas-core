"use server"

import { revalidatePath } from "next/cache"
import {
  activatePlatformPlan,
  archivePlatformPlan,
  createPlatformPlan,
  duplicatePlatformPlan,
  updatePlatformPlan,
} from "@/lib/platform-admin"

function text(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value.trim() : ""
}

function optionalNumber(formData: FormData, key: string) {
  const value = text(formData, key)
  return value ? Number(value) : undefined
}

function jsonObject(formData: FormData, key: string): { value: unknown } | { error: string } {
  const value = text(formData, key)
  if (!value) return { value: {} }
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: `${key} must be a JSON object.` }
    return { value: parsed }
  } catch {
    return { error: `${key} must contain valid JSON.` }
  }
}

function done(result: Awaited<ReturnType<typeof createPlatformPlan>>) {
  if (result.success) {
    revalidatePath("/platform/billing")
    revalidatePath("/platform/overrides")
  }
  return result
}

export async function createPlatformPlanAction(formData: FormData) {
  const features = jsonObject(formData, "features")
  const limits = jsonObject(formData, "limits")
  const metadata = jsonObject(formData, "metadata")
  if ("error" in features || "error" in limits || "error" in metadata) return { success: false as const, message: [features, limits, metadata].find((item) => "error" in item)?.error || "The plan definition is invalid." }
  return done(await createPlatformPlan({
    key: text(formData, "key"),
    name: text(formData, "name"),
    description: text(formData, "description") || null,
    sortOrder: optionalNumber(formData, "sortOrder"),
    features: features.value,
    limits: limits.value,
    metadata: metadata.value,
    recommended: formData.get("recommended") === "true",
    reason: text(formData, "reason"),
  }))
}

export async function updatePlatformPlanAction(formData: FormData) {
  const features = jsonObject(formData, "features")
  const limits = jsonObject(formData, "limits")
  const metadata = jsonObject(formData, "metadata")
  if ("error" in features || "error" in limits || "error" in metadata) return { success: false as const, message: [features, limits, metadata].find((item) => "error" in item)?.error || "The plan definition is invalid." }
  return done(await updatePlatformPlan({
    key: text(formData, "key"),
    name: text(formData, "name"),
    description: text(formData, "description") || null,
    sortOrder: optionalNumber(formData, "sortOrder"),
    features: features.value,
    limits: limits.value,
    metadata: metadata.value,
    recommended: formData.get("recommended") === "true",
    reason: text(formData, "reason"),
  }))
}

export async function activatePlatformPlanAction(formData: FormData) {
  return done(await activatePlatformPlan(text(formData, "key"), text(formData, "reason")))
}

export async function archivePlatformPlanAction(formData: FormData) {
  return done(await archivePlatformPlan(text(formData, "key"), text(formData, "reason")))
}

export async function duplicatePlatformPlanAction(formData: FormData) {
  return done(await duplicatePlatformPlan({
    sourceKey: text(formData, "sourceKey"),
    newKey: text(formData, "newKey"),
    name: text(formData, "name"),
    reason: text(formData, "reason"),
  }))
}
