import { readPaddlePriceMappings } from "./billing.js"
import type { ResolvedCliConfig } from "./cli-config.js"

export type ProviderConfigState = "required" | "optional" | "disabled" | "configured_unverified" | "operational" | "warning" | "error" | "unknown" | "not_configured"
export type ProviderConfigCheck = { key: string; label: string; state: ProviderConfigState; detail: string; missing?: string[] }

function configured(value: string | undefined): boolean { return Boolean(value?.trim()) }

export function inspectProviderConfiguration(environment: NodeJS.ProcessEnv = process.env, modules: Pick<ResolvedCliConfig, "billing" | "email" | "domains" | "pwa" | "push" | "platform"> = { billing: true, email: true, domains: false, pwa: false, push: false, platform: true }): ProviderConfigCheck[] {
  const checks: ProviderConfigCheck[] = []
  if (!modules.billing) checks.push({ key: "billing", label: "Paddle", state: "disabled", detail: "Disabled by configuration" })
  else {
    const required = ["PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET"]
    const missing = required.filter((key) => !configured(environment[key]))
    if (missing.length) checks.push({ key: "billing", label: "Paddle", state: "not_configured", detail: "Configure server credentials", missing })
    else {
      const mappings = readPaddlePriceMappings(environment)
      const expected = ["STARTER_MONTH", "STARTER_YEAR", "PRO_MONTH", "PRO_YEAR", "BUSINESS_MONTH", "BUSINESS_YEAR"]
      const missingMappings = expected.filter((key) => !configured(environment[`PADDLE_PRICE_${key}`]))
      checks.push({ key: "billing", label: "Paddle", state: "configured_unverified", detail: `Credentials present; live provider call not performed. Price mappings ${mappings.length}/6.`, missing: missingMappings })
    }
  }
  if (!modules.email) checks.push({ key: "email", label: "Resend", state: "disabled", detail: "Disabled by configuration; development invitation links remain available" })
  else {
    const missing = ["RESEND_API_KEY", "RESEND_FROM_EMAIL"].filter((key) => !configured(environment[key]))
    const from = environment.RESEND_FROM_EMAIL ?? ""
    const validFrom = !from || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)
    checks.push(missing.length ? { key: "email", label: "Resend", state: "not_configured", detail: "Configure server credentials", missing } : validFrom ? { key: "email", label: "Resend", state: "configured_unverified", detail: "Credentials present; delivery has not been tested" } : { key: "email", label: "Resend", state: "error", detail: "RESEND_FROM_EMAIL is not a valid email address" })
  }
  if (!modules.domains) checks.push({ key: "domains", label: "Vercel Domains", state: "disabled", detail: "Disabled by configuration" })
  else {
    const missing = ["VERCEL_TOKEN", "VERCEL_PROJECT_ID"].filter((key) => !configured(environment[key]))
    checks.push(missing.length ? { key: "domains", label: "Vercel Domains", state: "not_configured", detail: "Configure Vercel token and project id", missing } : { key: "domains", label: "Vercel Domains", state: "configured_unverified", detail: "Credentials present; provider has not been queried" })
  }
  if (!modules.pwa) checks.push({ key: "pwa", label: "PWA", state: "disabled", detail: "Disabled by configuration" })
  else checks.push({ key: "pwa", label: "PWA", state: "operational", detail: "Workspace manifest and service-worker hooks included" })
  if (!modules.push) checks.push({ key: "push", label: "Web Push", state: "disabled", detail: "Disabled by configuration" })
  else {
    const missing = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"].filter((key) => !configured(environment[key]))
    const subject = environment.VAPID_SUBJECT ?? ""
    checks.push(missing.length ? { key: "push", label: "Web Push", state: "not_configured", detail: "Configure VAPID public key, private key and subject", missing } : subject.startsWith("mailto:") ? { key: "push", label: "Web Push", state: "configured_unverified", detail: "VAPID configured; delivery has not been tested" } : { key: "push", label: "Web Push", state: "error", detail: "VAPID_SUBJECT must use a mailto: address" })
  }
  checks.push(modules.platform ? { key: "platform", label: "Platform Control", state: "operational", detail: "Operator routes and authorization boundary included" } : { key: "platform", label: "Platform Control", state: "disabled", detail: "Disabled by configuration" })
  return checks
}
