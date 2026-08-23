import { createInvitationToken, hashInvitationToken } from "@sapienx/saas-core"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { requireUser } from "./supabase.js"

// Product schemas are intentionally not coupled to Core's package-level generated
// database types. Runtime repositories validate the operation boundary and let
// the deployed Supabase schema remain the source of truth.
type Client = SupabaseClient

function fail(operation: string, error: { message?: string | null; code?: string | null } | null): never {
  throw new Error(`${operation} failed${error?.code ? ` (${error.code})` : ""}: ${error?.message ?? "unknown database error"}`)
}

function one<T>(data: T | T[] | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data
}

async function actor(client: Client): Promise<User> { return requireUser(client) }

export function createCoreRepositories(client: Client) {
  const workspaces = {
    async listUserWorkspaces() {
      const user = await actor(client)
      const result = await client.from("workspaces").select("id, name, slug, status, created_by, preferred_timezone, onboarding_completed_at, created_at, updated_at, workspace_members!inner(user_id, role, status)").eq("workspace_members.user_id", user.id).eq("workspace_members.status", "active").order("created_at", { ascending: true })
      if (result.error) fail("listUserWorkspaces", result.error)
      return result.data ?? []
    },
    async getWorkspace(workspaceId: string) {
      await actor(client)
      const result = await client.from("workspaces").select("id, name, slug, status, created_by, preferred_timezone, onboarding_completed_at, created_at, updated_at").eq("id", workspaceId).maybeSingle()
      if (result.error) fail("getWorkspace", result.error)
      return result.data
    },
    async createWorkspace(input: { name: string; slug: string; preferredTimezone?: string }) {
      await actor(client)
      const result = await client.rpc("create_workspace", { target_name: input.name, target_slug: input.slug, target_timezone: input.preferredTimezone ?? "UTC" })
      if (result.error) fail("createWorkspace", result.error)
      return one(result.data)
    },
    async updateWorkspace(input: { workspaceId: string; name?: string; preferredTimezone?: string; onboardingCompleted?: boolean }) {
      await actor(client)
      const result = await client.rpc("update_workspace", { target_workspace: input.workspaceId, target_name: input.name ?? null, target_timezone: input.preferredTimezone ?? null, target_onboarding_completed: input.onboardingCompleted ?? null })
      if (result.error) fail("updateWorkspace", result.error)
      return one(result.data)
    },
    async archiveWorkspace(workspaceId: string) {
      await actor(client)
      const result = await client.rpc("archive_workspace", { target_workspace: workspaceId })
      if (result.error) fail("archiveWorkspace", result.error)
      return one(result.data)
    },
  }

  const memberships = {
    async get(workspaceId: string, userId?: string) {
      const current = await actor(client)
      const result = await client.from("workspace_members").select("id, workspace_id, user_id, role, status, created_at, updated_at").eq("workspace_id", workspaceId).eq("user_id", userId ?? current.id).maybeSingle()
      if (result.error) fail("getMembership", result.error)
      return result.data
    },
    async list(workspaceId: string) {
      await actor(client)
      const result = await client.from("workspace_members").select("id, workspace_id, user_id, role, status, created_at, updated_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true })
      if (result.error) fail("listMembers", result.error)
      return result.data ?? []
    },
    async changeRole(input: { workspaceId: string; userId: string; role: string }) {
      await actor(client)
      const result = await client.rpc("change_member_role", { target_workspace: input.workspaceId, target_user: input.userId, target_role: input.role })
      if (result.error) fail("changeMemberRole", result.error)
      return one(result.data)
    },
    async remove(input: { workspaceId: string; userId: string }) {
      await actor(client)
      const result = await client.rpc("remove_member", { target_workspace: input.workspaceId, target_user: input.userId })
      if (result.error) fail("removeMember", result.error)
      return one(result.data)
    },
  }

  const invitations = {
    async create(input: { workspaceId: string; email: string; role: string; expiresAt?: string }) {
      await actor(client)
      const token = createInvitationToken()
      const result = await client.rpc("create_workspace_invitation", { target_workspace: input.workspaceId, target_email: input.email, target_role: input.role, target_token_hash: hashInvitationToken(token), target_expires_at: input.expiresAt ?? new Date(Date.now() + 7 * 86400000).toISOString() })
      if (result.error) fail("createInvitation", result.error)
      return { invitation: one(result.data), token }
    },
    async resend(invitationId: string) {
      await actor(client)
      const token = createInvitationToken()
      const result = await client.rpc("resend_workspace_invitation", { target_invitation: invitationId, target_token_hash: hashInvitationToken(token) })
      if (result.error) fail("resendInvitation", result.error)
      return { invitation: one(result.data), token }
    },
    async revoke(invitationId: string) {
      await actor(client)
      const result = await client.rpc("revoke_workspace_invitation", { target_invitation: invitationId })
      if (result.error) fail("revokeInvitation", result.error)
      return one(result.data)
    },
    async accept(input: { invitationId: string; token: string }) {
      await actor(client)
      const result = await client.rpc("accept_workspace_invitation", { target_invitation: input.invitationId, target_token_hash: hashInvitationToken(input.token) })
      if (result.error) fail("acceptInvitation", result.error)
      return one(result.data)
    },
  }

  const entitlements = {
    async get(workspaceId: string, at?: string) {
      await actor(client)
      const result = await client.rpc("get_effective_entitlements", { target_workspace: workspaceId, target_at: at ?? new Date().toISOString() })
      if (result.error) fail("getEntitlements", result.error)
      return one(result.data)
    },
  }

  const usage = {
    async consume(input: { workspaceId: string; metric: string; amount?: number; periodStart?: string; periodEnd?: string }) {
      await actor(client)
      const result = await client.rpc("consume_usage", { target_workspace: input.workspaceId, target_metric: input.metric, increment_by: input.amount ?? 1, target_period_start: input.periodStart ?? null, target_period_end: input.periodEnd ?? null })
      if (result.error) fail("consumeUsage", result.error)
      return one(result.data)
    },
    async get(workspaceId: string, metric: string, periodStart?: string) {
      await actor(client)
      const result = await client.from("workspace_usage_periods").select("workspace_id, metric, period_start, period_end, amount, updated_at").eq("workspace_id", workspaceId).eq("metric", metric).eq("period_start", periodStart ?? new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10)).maybeSingle()
      if (result.error) fail("getUsage", result.error)
      return result.data
    },
  }

  const billing = {
    async getSubscription(workspaceId: string) {
      await actor(client)
      const result = await client.from("workspace_subscriptions").select("*").eq("workspace_id", workspaceId).maybeSingle()
      if (result.error) fail("getSubscription", result.error)
      return result.data
    },
    async listPlans() {
      const result = await client.from("plans").select("*").eq("active", true).order("sort_order", { ascending: true })
      if (result.error) fail("listPlans", result.error)
      return result.data ?? []
    },
    async insertWebhook(record: { provider: "paddle"; providerEventId: string; eventType: string; occurredAt: string; payload: Record<string, unknown>; status: string; attempts: number; errorCode: string | null; errorMessage: string | null; processedAt: string | null }) {
      const result = await client.from("billing_webhook_events").insert({ provider: record.provider, provider_event_id: record.providerEventId, event_type: record.eventType, occurred_at: record.occurredAt, payload: record.payload, status: record.status, attempts: record.attempts, error_code: record.errorCode, error_message: record.errorMessage, processed_at: record.processedAt }).select("*").maybeSingle()
      if (!result.error) return { inserted: true, record: result.data }
      if (result.error.code !== "23505") fail("insertWebhook", result.error)
      const existing = await client.from("billing_webhook_events").select("*").eq("provider", record.provider).eq("provider_event_id", record.providerEventId).maybeSingle()
      if (existing.error) fail("getWebhook", existing.error)
      return { inserted: false, record: existing.data }
    },
    async markWebhookProcessing(eventId: string) { const result = await client.from("billing_webhook_events").update({ status: "processing", processing_started_at: new Date().toISOString() }).eq("provider", "paddle").eq("provider_event_id", eventId).select("attempts").maybeSingle(); if (result.error) fail("markWebhookProcessing", result.error); await client.from("billing_webhook_events").update({ attempts: (result.data?.attempts ?? 0) + 1 }).eq("provider", "paddle").eq("provider_event_id", eventId) },
    async markWebhookProcessed(eventId: string) { const result = await client.from("billing_webhook_events").update({ status: "processed", processed_at: new Date().toISOString(), error_code: null, error_message: null }).eq("provider", "paddle").eq("provider_event_id", eventId); if (result.error) fail("markWebhookProcessed", result.error) },
    async markWebhookIgnored(eventId: string, reason: string) { const result = await client.from("billing_webhook_events").update({ status: "ignored", error_code: "STALE_OR_UNSUPPORTED", error_message: reason, processed_at: new Date().toISOString() }).eq("provider", "paddle").eq("provider_event_id", eventId); if (result.error) fail("markWebhookIgnored", result.error) },
    async markWebhookFailed(eventId: string, error: { code: string; message: string }) { const result = await client.from("billing_webhook_events").update({ status: "failed", error_code: error.code, error_message: error.message }).eq("provider", "paddle").eq("provider_event_id", eventId); if (result.error) fail("markWebhookFailed", result.error) },
  }

  const audit = {
    async list(workspaceId: string, limit = 100) {
      await actor(client)
      const result = await client.from("audit_events").select("*").eq("entity_type", "workspace").eq("entity_id", workspaceId).order("created_at", { ascending: false }).limit(limit)
      if (result.error) fail("listAudit", result.error)
      return result.data ?? []
    },
  }

  const platform = {
    async getCurrentMember() {
      const user = await actor(client)
      const result = await client.from("platform_members").select("user_id, role, status, created_by, created_at, updated_at").eq("user_id", user.id).maybeSingle()
      if (result.error) fail("getPlatformMember", result.error)
      return result.data
    },
    async listWorkspaces() {
      await actor(client)
      const result = await client.rpc("platform_list_workspaces")
      if (result.error) fail("platformListWorkspaces", result.error)
      return result.data ?? []
    },
    async supportView(workspaceId: string) {
      await actor(client)
      const result = await client.rpc("platform_support_view", { target_workspace: workspaceId })
      if (result.error) fail("platformSupportView", result.error)
      return one(result.data)
    },
  }

  const domains = {
    async list(workspaceId: string) {
      await actor(client)
      const result = await client.from("workspace_domains").select("*").eq("workspace_id", workspaceId)
      if (result.error) fail("listDomains", result.error)
      return result.data ?? []
    },
    async create(workspaceId: string, hostname: string) {
      await actor(client)
      const result = await client.rpc("create_workspace_domain", { target_workspace: workspaceId, target_hostname: hostname })
      if (result.error) fail("createDomain", result.error)
      return one(result.data)
    },
  }

  const pwa = {
    async get(workspaceId: string) {
      await actor(client)
      const result = await client.from("workspace_pwa_settings").select("*").eq("workspace_id", workspaceId).maybeSingle()
      if (result.error) fail("getPwaSettings", result.error)
      return result.data
    },
    async upsert(input: { workspaceId: string; appName?: string; iconUrl?: string; themeColor?: string; backgroundColor?: string }) {
      await actor(client)
      const result = await client.rpc("upsert_workspace_pwa_settings", { target_workspace: input.workspaceId, target_app_name: input.appName ?? null, target_icon_url: input.iconUrl ?? null, target_theme_color: input.themeColor ?? null, target_background_color: input.backgroundColor ?? null })
      if (result.error) fail("upsertPwaSettings", result.error)
      return one(result.data)
    },
  }

  const push = {
    async subscribe(input: { workspaceId: string; endpoint: string; p256dh: string; auth: string }) {
      await actor(client)
      const result = await client.rpc("upsert_push_subscription", { target_workspace: input.workspaceId, target_endpoint: input.endpoint, target_p256dh: input.p256dh, target_auth: input.auth })
      if (result.error) fail("subscribePush", result.error)
      return one(result.data)
    },
    async unsubscribe(input: { workspaceId: string; endpoint: string }) {
      await actor(client)
      const result = await client.rpc("revoke_push_subscription", { target_workspace: input.workspaceId, target_endpoint: input.endpoint })
      if (result.error) fail("unsubscribePush", result.error)
      return one(result.data)
    },
  }

  return { workspaces, memberships, invitations, entitlements, usage, billing, audit, platform, domains, pwa, push }
}
