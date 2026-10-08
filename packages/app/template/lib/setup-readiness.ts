import "server-only"

import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess, getPreferredWorkspaceId, getWorkspaceMemberships } from "@/lib/auth-utils"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { getDevMailpitUrl } from "@/lib/dev-mailpit"
import { PRODUCT_CONFIG, type ProductPlanDefinition } from "@/lib/product-config"
import { isBillingProviderConfigured } from "@/lib/billing/providers"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase"

export type SetupReadiness = {
  user: { email: string; emailConfirmed: boolean }
  workspace: {
    created: boolean
    name: string | null
    role: string | null
    planName: string | null
    planKey: string | null
    workspaceLimit: number | null | "not-configured"
    coreOnboardingComplete: boolean
  }
  platform: {
    visible: boolean
    configured: boolean
    accountExists: boolean | null
    membershipActive: boolean
    role: string | null
    configuredEmail: string | null
  }
  delivery: {
    mailpitUrl: string | null
    emailProviderConfigured: boolean
    billingProviderConfigured: boolean
    domainProviderConfigured: boolean
    pushConfigured: boolean
  }
}

function hasOwn(value: object | null | undefined, key: string) {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key))
}

function localMailpitUrl() {
  try {
    return getDevMailpitUrl(new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").hostname)
  } catch {
    return getDevMailpitUrl("localhost")
  }
}

export async function getSetupReadiness(): Promise<SetupReadiness | null> {
  const { data, error } = await (await createSupabaseServerClient()).auth.getUser()
  if (error || !data.user) return null

  const [state, access] = await Promise.all([getAccountState(), getCurrentUserAccess()])
  const memberships = await getWorkspaceMemberships(data.user.id)
  const preferred = await getPreferredWorkspaceId()
  const membership = memberships.memberships.find((item) => item.workspace_id === preferred) || memberships.memberships[0]
  const entitlements = membership ? await getWorkspaceEntitlements(membership.workspace_id).catch(() => null) : null
  const configuredEmail = process.env.PLATFORM_OWNER_EMAIL?.trim().toLowerCase() || ""
  let accountExists: boolean | null = null
  if (configuredEmail) {
    try {
      const users = await (createServiceRoleClient() as any).auth.admin.listUsers({ page: 1, perPage: 1000 })
      accountExists = Boolean(users.data?.users?.some((user: { email?: string }) => user.email?.trim().toLowerCase() === configuredEmail))
    } catch {
      accountExists = null
    }
  }

  const defaultPlan = PRODUCT_CONFIG.catalog.plans.find((plan) => plan.key === PRODUCT_CONFIG.catalog.defaultPlanKey) as (ProductPlanDefinition & { active?: boolean }) | undefined
  const workspaceLimit = defaultPlan && hasOwn(defaultPlan.limits, "core.workspaces")
    ? defaultPlan.limits?.["core.workspaces"] ?? null
    : "not-configured"
  const workspace = membership?.workspaces
  const workspaceName = Array.isArray(workspace) ? workspace[0]?.name || null : workspace?.name || null

  return {
    user: { email: data.user.email || "", emailConfirmed: Boolean(data.user.email_confirmed_at) },
    workspace: {
      created: Boolean(state.authenticated && state.workspaceId),
      name: workspaceName,
      role: membership?.role || null,
      planName: entitlements?.planName || null,
      planKey: entitlements?.planKey || null,
      workspaceLimit,
      coreOnboardingComplete: state.authenticated ? state.onboardingComplete : false,
    },
    platform: {
      visible: process.env.NODE_ENV !== "production" || Boolean(access?.platformRole),
      configured: Boolean(configuredEmail),
      accountExists,
      membershipActive: Boolean(access?.platformRole),
      role: access?.platformRole || null,
      configuredEmail: process.env.NODE_ENV !== "production" || Boolean(access?.platformRole) ? configuredEmail || null : null,
    },
    delivery: {
      mailpitUrl: localMailpitUrl(),
      emailProviderConfigured: Boolean(process.env.RESEND_API_KEY),
      billingProviderConfigured: isBillingProviderConfigured(),
      domainProviderConfigured: Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID),
      pushConfigured: Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY),
    },
  }
}
