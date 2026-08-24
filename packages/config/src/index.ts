import { z } from "zod"
import type { FeatureDefinition, MetricDefinition } from "@sapienx/saas-core"

const providerSchema = z.object({ name: z.string().min(1), enabled: z.boolean().default(true) })

export const saasCoreConfigSchema = z.object({
  version: z.literal("1.1.0"),
  product: z.object({ key: z.string().regex(/^[a-z][a-z0-9-]+$/), name: z.string().min(1), url: z.string().url().optional() }),
  auth: z.object({ provider: z.literal("supabase"), requireEmailConfirmation: z.boolean().default(true) }),
  workspace: z.object({ slugSource: z.enum(["server", "user_input"]).default("user_input"), defaultTimezone: z.string().default("UTC") }),
  permissions: z.object({ custom: z.record(z.array(z.string())).default({}) }),
  billing: z.object({ enabled: z.boolean().default(true), provider: z.literal("paddle"), environment: z.enum(["sandbox", "live"]) }),
  entitlements: z.object({ features: z.array(z.string()).default([]), metrics: z.array(z.string()).default([]) }),
  usage: z.object({ enabled: z.boolean().default(true) }),
  notifications: z.object({ email: providerSchema, push: providerSchema }),
  domains: z.object({ enabled: z.boolean().default(false), rootDomain: z.string().optional(), appDomain: z.string().optional() }),
  pwa: z.object({ enabled: z.boolean().default(false) }),
  platform: z.object({ enabled: z.boolean().default(true), supportReadOnly: z.boolean().default(true) }),
})

export type SaaSCoreConfig = z.infer<typeof saasCoreConfigSchema> & { productDefinitions?: { features: FeatureDefinition[]; metrics: MetricDefinition[] } }

export function defineSaaSCore(input: SaaSCoreConfig): SaaSCoreConfig {
  return saasCoreConfigSchema.parse(input) as SaaSCoreConfig
}

export function validateSaaSCoreConfig(input: unknown): { success: true; data: SaaSCoreConfig } | { success: false; errors: string[] } {
  const result = saasCoreConfigSchema.safeParse(input)
  return result.success ? { success: true, data: result.data as SaaSCoreConfig } : { success: false, errors: result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) }
}

export function defaultSaaSCoreConfig(product: { key: string; name: string }): SaaSCoreConfig {
  return defineSaaSCore({ version: "1.1.0", product, auth: { provider: "supabase", requireEmailConfirmation: true }, workspace: { slugSource: "user_input", defaultTimezone: "UTC" }, permissions: { custom: {} }, billing: { enabled: true, provider: "paddle", environment: "sandbox" }, entitlements: { features: [], metrics: [] }, usage: { enabled: true }, notifications: { email: { name: "resend", enabled: true }, push: { name: "web-push", enabled: false } }, domains: { enabled: false }, pwa: { enabled: false }, platform: { enabled: true, supportReadOnly: true } })
}
