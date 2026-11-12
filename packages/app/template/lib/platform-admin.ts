import "server-only"

import { requirePlatformBillingAccess, requirePlatformRole, requirePlatformWriteAccess } from "@/lib/platform-authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { audit } from "@/lib/platform-audit"
import { formatPlatformRole } from "@/lib/platform-types"
import { duplicateProductPlan, hasCommercialPlanChange, normalizeProductPlan, validatePlanDefinition, type ProductPlan } from "@sapienx/saas-core"
import { getConfiguredFallbackPlanKey } from "@/lib/billing/reconciliation"

const service = () => createServiceRoleClient() as any

export type PlatformUserRecord = {
  id: string
  user_id: string
  email: string | null
  name: string | null
  platform_role: string | null
  platform_status: "active" | "suspended" | "none"
  workspace_count: number
  workspace_label: string
  workspace_names: string[]
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  is_current_user: boolean
  is_protected_owner: boolean
  user_label: string
  user_email: string | null
  role_label: string
}

export type PlatformUserActionResult =
  | { success: true; message: string; userId?: string; recoveryLink?: string | null }
  | { success: false; message: string }

const platformRoles = ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"] as const
type PlatformUserStatus = "active" | "suspended"
type PlatformMutationContext = { error: string } | { access: { userId: string }; db: any; user: any; member: any }
type ValidUserInput = { error: string } | { email: string; name: string; role: string; status: PlatformUserStatus; reason: string; password: string }

function userName(user: any) {
  const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {}
  return [metadata.full_name, metadata.name, metadata.display_name, metadata.username, metadata.preferred_username]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || null
}

async function listAllAuthUsers(db: any) {
  const users: any[] = []
  for (let page = 1; page <= 100; page += 1) {
    const result = await db.auth.admin.listUsers({ page, perPage: 1000 })
    if (result.error) throw new Error(result.error.message)
    const batch = result.data?.users || []
    users.push(...batch)
    if (batch.length < 1000) break
  }
  return users
}

export async function listPlatformUserRecords(input: { query?: string; role?: string; status?: "active" | "suspended" | "none" } = {}) {
  const { access } = await requirePlatformRole()
  const db = service()
  const [users, platformResult, controlsResult, membersResult, workspacesResult] = await Promise.all([
    listAllAuthUsers(db),
    db.from("platform_members").select("user_id, role, status, created_at"),
    db.from("platform_user_controls").select("user_id, status"),
    db.from("workspace_members").select("user_id, workspace_id, role"),
    db.from("workspaces").select("id, name, slug"),
  ])
  for (const result of [platformResult, controlsResult, membersResult, workspacesResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  const platformByUser = new Map<string, any>((platformResult.data || []).map((row: any) => [row.user_id, row]))
  const controlByUser = new Map<string, any>((controlsResult.data || []).map((row: any) => [row.user_id, row]))
  const workspaceById = new Map<string, any>((workspacesResult.data || []).map((row: any) => [row.id, row]))
  const membershipsByUser = new Map<string, any[]>()
  for (const row of membersResult.data || []) membershipsByUser.set(row.user_id, [...(membershipsByUser.get(row.user_id) || []), row])
  const records: PlatformUserRecord[] = users.map((user: any) => {
    const member = platformByUser.get(user.id)
    const control = controlByUser.get(user.id)
    const memberships = membershipsByUser.get(user.id) || []
    const workspaceNames = memberships.map((item) => workspaceById.get(item.workspace_id)?.name || workspaceById.get(item.workspace_id)?.slug || "Unknown workspace")
    const name = userName(user)
    const email = typeof user.email === "string" && user.email.trim() ? user.email.trim() : null
    const status: PlatformUserRecord["platform_status"] = member ? (member.status === "suspended" || control?.status === "suspended" ? "suspended" : "active") : "none"
    const role = typeof member?.role === "string" ? member.role : null
    return {
      id: user.id,
      user_id: user.id,
      email,
      name,
      platform_role: role,
      platform_status: status,
      workspace_count: memberships.length,
      workspace_label: workspaceNames[0] || "No workspace access",
      workspace_names: workspaceNames,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at || null,
      email_confirmed_at: user.email_confirmed_at || null,
      is_current_user: user.id === access.userId,
      is_protected_owner: role === "platform_owner" && status === "active",
      user_label: name || email || "Unknown user",
      user_email: name && email ? email : null,
      role_label: role ? formatPlatformRole(role) : "No platform access",
    }
  })
  const query = input.query?.trim().toLowerCase() || ""
  return records
    .filter((row) => !input.role || input.role === "all" || row.platform_role === input.role)
    .filter((row) => !input.status || row.platform_status === input.status)
    .filter((row) => !query || [row.user_id, row.email, row.name, row.platform_role, row.role_label, row.platform_status, ...row.workspace_names].some((value) => value?.toLowerCase().includes(query)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

async function getPlatformMutationContext(targetUserId: string, action: string): Promise<PlatformMutationContext> {
  const { access } = await requirePlatformWriteAccess()
  if (!targetUserId) return { error: "A user is required." as const }
  if (action === "delete" && targetUserId === access.userId) return { error: "You cannot delete the account you are currently using." as const }
  if (action === "suspend" && targetUserId === access.userId) return { error: "You cannot suspend the account you are currently using." as const }
  const db = service()
  const userResult = await db.auth.admin.getUserById(targetUserId)
  if (userResult.error || !userResult.data?.user) return { error: "That user could not be found." as const }
  const memberResult = await db.from("platform_members").select("user_id, role, status").eq("user_id", targetUserId).maybeSingle()
  if (memberResult.error) throw new Error(memberResult.error.message)
  return { access, db, user: userResult.data.user, member: memberResult.data || null }
}

function validUserInput(input: { email?: string; name?: string; role?: string; status?: string; reason?: string; password?: string }): ValidUserInput {
  const email = input.email?.trim().toLowerCase() || ""
  const name = input.name?.trim() || ""
  const role = input.role?.trim() || ""
  const status = input.status === "suspended" ? "suspended" : "active"
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." as const }
  if (name.length > 120) return { error: "The display name is too long." as const }
  if (!platformRoles.includes(role as (typeof platformRoles)[number])) return { error: "That platform role is not valid." as const }
  if ((input.reason || "").trim().length < 3) return { error: "Add a short reason for this access change." as const }
  if (input.password && input.password.length > 0 && input.password.length < 8) return { error: "A password must be at least 8 characters." as const }
  return { email, name, role, status: status as PlatformUserStatus, reason: input.reason!.trim(), password: input.password?.trim() || "" }
}

function safeUserAudit(user: any, member: any) {
  return { email: user?.email || null, name: userName(user), role: member?.role || null, status: member?.status || "none" }
}

async function wouldLockOutLastOwner(context: { db: any; member: any }, role: string, status: PlatformUserStatus) {
  if (context.member?.role !== "platform_owner" || context.member.status !== "active") return false
  if (role === "platform_owner" && status === "active") return false
  const result = await context.db.from("platform_members").select("user_id", { count: "exact", head: true }).eq("role", "platform_owner").eq("status", "active").neq("user_id", context.member.user_id)
  if (result.error) throw new Error(result.error.message)
  return (result.count || 0) === 0
}

function accessMutationError(error: any, fallback: string) {
  return typeof error?.message === "string" && error.message.includes("PLATFORM_OWNER_LOCKOUT")
    ? "Keep at least one active Platform Owner before changing or deleting this user."
    : fallback
}

export async function createPlatformUser(input: { email: string; name?: string; role: string; status: PlatformUserStatus; password?: string; reason: string }): Promise<PlatformUserActionResult> {
  const { access } = await requirePlatformWriteAccess()
  const valid = validUserInput(input)
  if ("error" in valid) return { success: false, message: valid.error }
  const db = service()
  let createdUser: any = null
  try {
    const result = valid.password
      ? await db.auth.admin.createUser({ email: valid.email, password: valid.password, email_confirm: true, user_metadata: { full_name: valid.name || undefined } })
      : await db.auth.admin.inviteUserByEmail(valid.email, { data: { full_name: valid.name || undefined } })
    if (result.error || !result.data?.user) throw new Error(result.error?.message || "The account could not be created.")
    createdUser = result.data.user
    const { error } = await db.from("platform_members").insert({ user_id: createdUser.id, role: valid.role, status: valid.status, created_by: access.userId })
    if (error) throw new Error(error.message)
    if (valid.status === "suspended") {
      const control = await db.from("platform_user_controls").upsert({ user_id: createdUser.id, status: "suspended", reason: valid.reason, suspended_by: access.userId, suspended_at: new Date().toISOString() })
      if (control.error) throw new Error(control.error.message)
    }
    await audit({ actorUserId: access.userId, action: "platform_user.created", entityType: "auth_user", entityId: createdUser.id, after: { email: valid.email, name: valid.name || null, role: valid.role, status: valid.status }, reason: valid.reason })
    return { success: true, message: valid.password ? "User created and ready to sign in." : "User created; an invitation was sent.", userId: createdUser.id }
  } catch (error) {
    if (createdUser?.id) await db.auth.admin.deleteUser(createdUser.id).catch(() => undefined)
    return { success: false, message: error instanceof Error ? error.message : "The user could not be created." }
  }
}

export async function updatePlatformUser(input: { userId: string; email: string; name?: string; role: string; status: PlatformUserStatus; reason: string }): Promise<PlatformUserActionResult> {
  const context = await getPlatformMutationContext(input.userId, input.status === "suspended" ? "suspend" : "update")
  if ("error" in context) return { success: false, message: context.error }
  const valid = validUserInput(input)
  if ("error" in valid) return { success: false, message: valid.error }
  if (await wouldLockOutLastOwner(context, valid.role, valid.status)) return { success: false, message: "Keep at least one active Platform Owner before changing or deleting this user." }
  const before = safeUserAudit(context.user, context.member)
  const userUpdate = await context.db.auth.admin.updateUserById(input.userId, { email: valid.email, email_confirm: true, user_metadata: { ...(context.user.user_metadata || {}), full_name: valid.name || undefined } })
  if (userUpdate.error) return { success: false, message: userUpdate.error.message }
  const memberUpdate = await context.db.from("platform_members").upsert({ user_id: input.userId, role: valid.role, status: valid.status, created_by: context.access.userId, updated_at: new Date().toISOString() })
  if (memberUpdate.error) return { success: false, message: accessMutationError(memberUpdate.error, "Profile saved, but platform access could not be saved.") }
  const control = await context.db.from("platform_user_controls").upsert({ user_id: input.userId, status: valid.status, reason: valid.status === "suspended" ? valid.reason : null, suspended_by: valid.status === "suspended" ? context.access.userId : null, suspended_at: valid.status === "suspended" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
  if (control.error) return { success: false, message: accessMutationError(control.error, "Platform access saved, but the control state could not be synchronized.") }
  await audit({ actorUserId: context.access.userId, action: "platform_user.updated", entityType: "auth_user", entityId: input.userId, before, after: { email: valid.email, name: valid.name || null, role: valid.role, status: valid.status }, reason: valid.reason })
  return { success: true, message: valid.status === "suspended" ? "User suspended." : "User access updated.", userId: input.userId }
}

export async function deletePlatformUser(userId: string, reason: string): Promise<PlatformUserActionResult> {
  const context = await getPlatformMutationContext(userId, "delete")
  if ("error" in context) return { success: false, message: context.error }
  if (reason.trim().length < 3) return { success: false, message: "Add a short reason before deleting a user." }
  const before = safeUserAudit(context.user, context.member)
  const result = await context.db.auth.admin.deleteUser(userId)
  if (result.error) return { success: false, message: result.error.message.includes("foreign key") ? "This user owns protected data. Suspend the account instead of deleting it." : result.error.message }
  await audit({ actorUserId: context.access.userId, action: "platform_user.deleted", entityType: "auth_user", entityId: userId, before, reason })
  return { success: true, message: "User deleted.", userId }
}

export async function bulkSetPlatformUserStatus(userIds: string[], status: PlatformUserStatus, reason: string): Promise<PlatformUserActionResult> {
  if (reason.trim().length < 3) return { success: false, message: "Add a short reason before applying a bulk action." }
  const records = await listPlatformUserRecords()
  const byId = new Map(records.map((row) => [row.id, row]))
  const results = []
  for (const userId of [...new Set(userIds)].slice(0, 100)) {
    const row = byId.get(userId)
    results.push(!row ? { success: false as const, message: "That user could not be found." } : !row.platform_role ? { success: false as const, message: "This user has no platform access. Edit the user to grant a role first." } : await updatePlatformUser({ userId, email: row.email || "", name: row.name || "", role: row.platform_role, status, reason }))
  }
  const failures = results.filter((result) => !result.success)
  return failures.length ? { success: false, message: `${results.length - failures.length} users updated; ${failures.length} could not be changed. ${failures[0]?.message || "Try again."}` } : { success: true, message: `${results.length} users ${status === "active" ? "activated" : "suspended"}.` }
}

export async function bulkDeletePlatformUsers(userIds: string[], reason: string): Promise<PlatformUserActionResult> {
  if (reason.trim().length < 3) return { success: false, message: "Add a short reason before applying a bulk action." }
  const results = []
  for (const userId of [...new Set(userIds)].slice(0, 100)) results.push(await deletePlatformUser(userId, reason))
  const failures = results.filter((result) => !result.success)
  return failures.length ? { success: false, message: `${results.length - failures.length} users deleted; ${failures.length} could not be deleted. ${failures[0]?.message || "Try again."}` } : { success: true, message: `${results.length} users deleted.` }
}

export async function createPlatformUserRecoveryLink(userId: string): Promise<PlatformUserActionResult> {
  const context = await getPlatformMutationContext(userId, "recovery")
  if ("error" in context) return { success: false, message: context.error }
  if (!context.user.email) return { success: false, message: "This user has no email address for recovery." }
  const result = await context.db.auth.admin.generateLink({ type: "recovery", email: context.user.email })
  if (result.error || !result.data?.properties?.action_link) return { success: false, message: result.error?.message || "A recovery link could not be generated." }
  await audit({ actorUserId: context.access.userId, action: "platform_user.recovery_link_created", entityType: "auth_user", entityId: userId, reason: "Platform operator requested access recovery." })
  return { success: true, message: "Recovery link generated. Copy it to the user through a trusted channel.", userId, recoveryLink: result.data.properties.action_link }
}

export async function resendPlatformUserInvite(userId: string): Promise<PlatformUserActionResult> {
  const context = await getPlatformMutationContext(userId, "invite")
  if ("error" in context) return { success: false, message: context.error }
  if (!context.user.email) return { success: false, message: "This user has no email address for an invitation." }
  if (context.user.email_confirmed_at) return { success: false, message: "This user has already confirmed their email. Use Reset access instead." }
  const result = await context.db.auth.admin.inviteUserByEmail(context.user.email, { data: { full_name: userName(context.user) || undefined } })
  if (result.error) return { success: false, message: result.error.message }
  await audit({ actorUserId: context.access.userId, action: "platform_user.invite_resent", entityType: "auth_user", entityId: userId, reason: "Platform operator resent the pending invitation." })
  return { success: true, message: "Invitation resent.", userId }
}

export async function getPlatformOverview() {
  const { role } = await requirePlatformRole(); const db = service()
  const [workspaces, users, subscriptions, domains, events] = await Promise.all([
    db.from("workspaces").select("id", { count: "exact", head: true }), db.from("workspace_members").select("user_id", { count: "exact", head: true }), db.from("workspace_subscriptions").select("id", { count: "exact", head: true }), db.from("workspace_domains").select("id", { count: "exact", head: true }), db.from("platform_audit_logs").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
  ])
  return { role, counts: { workspaces: workspaces.count || 0, users: users.count || 0, subscriptions: subscriptions.count || 0, domains: domains.count || 0, events24h: events.count || 0 } }
}
export async function listPlatformWorkspaces(query = "") { await requirePlatformRole(); const db = service(); let request = db.from("workspaces").select("id, name, slug, status, created_at").order("created_at", { ascending: false }).limit(100); if (query) request = request.where({ any: [{ column: "name", operator: "ilike", value: "%" + query + "%" }, { column: "slug", operator: "ilike", value: "%" + query + "%" }] }); const { data, error } = await request; if (error) throw new Error(error.message); return data || [] }
export async function listPlatformUsers(query = "") {
  return listPlatformUserRecords({ query })
}
export async function listPlatformDomains(query = "") {
  await requirePlatformRole(); const db = service(); const { data, error } = await db.from("workspace_domains").select("id, workspace_id, hostname, status, verification_state, provider_verified, dns_configured, last_checked_at").order("created_at", { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  const rows = data || []; const workspaceIds = [...new Set(rows.map((row: any) => row.workspace_id).filter(Boolean))]
  const { data: workspaces } = workspaceIds.length ? await db.from("workspaces").select("id, name, slug").in("id", workspaceIds) : { data: [] }
  const workspaceMap = new Map<string, any>((workspaces || []).map((workspace: any) => [workspace.id, workspace]))
  const enriched = rows.map((row: any) => { const workspace = workspaceMap.get(row.workspace_id); return { ...row, workspace_label: workspace?.name || workspace?.slug || "Unknown workspace", workspace_slug: workspace?.slug || null } })
  const value = query.trim().toLowerCase(); return enriched.filter((row: any) => !value || [row.hostname, row.workspace_id, row.workspace_label, row.workspace_slug, row.status, row.verification_state].some((field) => typeof field === "string" && field.toLowerCase().includes(value)))
}
export async function listPlatformAuditLogs(query = "") {
  await requirePlatformRole(); const db = service(); const { data, error } = await db.from("platform_audit_logs").select("id, actor_user_id, action, entity_type, entity_id, reason, created_at").order("created_at", { ascending: false }).limit(100)
  if (error) throw new Error(error.message)
  const rows = data || []; const actorIds = [...new Set(rows.map((row: any) => row.actor_user_id).filter(Boolean))]; const auth = actorIds.length ? await db.auth.admin.listUsers({ page: 1, perPage: 1000 }) : { data: { users: [] } }
  const users = new Map<string, any>((auth.data?.users || []).map((user: any) => [user.id, user]))
  const enriched = rows.map((row: any) => { const user = users.get(row.actor_user_id); const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {}; const name = [metadata.full_name, metadata.name, metadata.display_name, metadata.username].find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || null; const email = typeof user?.email === "string" && user.email.trim() ? user.email.trim() : null; return { ...row, actor_label: name || email || "System or unknown actor", actor_email: name && email ? email : null } })
  const value = query.trim().toLowerCase(); return enriched.filter((row: any) => !value || [row.action, row.entity_type, row.entity_id, row.reason, row.actor_user_id, row.actor_label, row.actor_email].filter((field) => typeof field === "string").some((field) => field.toLowerCase().includes(value)))
}
export type PlatformPlanRecord = {
  key: string
  name: string
  description: string | null
  active: boolean
  sort_order: number
  features: Record<string, unknown>
  limits: Record<string, unknown>
  metadata: Record<string, unknown>
  referenced: boolean
}

export type PlatformPlanActionResult =
  | { success: true; message: string; planKey: string }
  | { success: false; message: string }

export type CreatePlatformPlanInput = {
  key: string
  name: string
  description?: string | null
  sortOrder?: number
  features?: unknown
  limits?: unknown
  metadata?: unknown
  recommended?: boolean
  reason: string
}

export type UpdatePlatformPlanInput = {
  key: string
  name: string
  description?: string | null
  sortOrder?: number
  features?: unknown
  limits?: unknown
  metadata?: unknown
  recommended?: boolean
  reason: string
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function planDefinitionFromRow(row: any): ProductPlan {
  const storedMetadata = objectValue(row.metadata)
  const recommended = typeof storedMetadata.recommended === "boolean" ? storedMetadata.recommended : undefined
  const metadata = Object.fromEntries(Object.entries(storedMetadata).filter(([key]) => key !== "recommended"))
  return normalizeProductPlan({
    key: row.key,
    name: row.name,
    description: typeof row.description === "string" && row.description.trim() ? row.description : undefined,
    active: row.active !== false,
    ...(recommended === undefined ? {} : { recommended }),
    sort_order: row.sort_order,
    features: objectValue(row.features),
    limits: objectValue(row.limits),
    metadata,
  })
}

function planRowFromDefinition(plan: ProductPlan) {
  const metadata = { ...objectValue(plan.metadata), ...(plan.recommended === undefined ? {} : { recommended: plan.recommended }) }
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description || null,
    active: plan.active !== false,
    sort_order: plan.sort_order ?? plan.sortOrder ?? 0,
    features: plan.features || {},
    limits: plan.limits || {},
    metadata,
  }
}

function planAuditValue(plan: ProductPlan) {
  return {
    key: plan.key,
    name: plan.name,
    description: plan.description || null,
    active: plan.active !== false,
    sort_order: plan.sort_order ?? plan.sortOrder ?? 0,
    features: plan.features || {},
    limits: plan.limits || {},
  }
}

function validPlanReason(reason: string) {
  return typeof reason === "string" && reason.trim().length >= 3
}

function planMutationError(error: unknown, fallback: string) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : ""
  const message = error instanceof Error ? error.message : ""
  if (code === "23505") return "A plan with that key already exists."
  if (code === "23503") return "This plan is still referenced by billing history."
  if (message.includes("PLAN_REFERENCED_IMMUTABLE")) return "This plan has subscription history; change its name, copy, or order instead of its entitlements."
  if (message.includes("PLAN_REFERENCED_ACTIVE")) return "This plan is still used by an active subscription or scheduled change."
  console.error("Platform plan operation failed", { code: code || "PLAN_OPERATION_FAILED" })
  return fallback
}

async function readPlatformPlan(db: any, key: string) {
  let result = await db.from("plans").select("key, name, description, active, sort_order, features, limits, metadata").eq("key", key).maybeSingle()
  if (result.error?.code === "42703") result = await db.from("plans").select("key, name, active, sort_order, features, limits, metadata").eq("key", key).maybeSingle()
  if (result.error) throw result.error
  return result.data ? planDefinitionFromRow(result.data) : null
}

async function listPlanRows(db: any) {
  let result = await db.from("plans").select("key, name, description, active, sort_order, features, limits, metadata").order("sort_order", { ascending: true }).order("key", { ascending: true })
  if (result.error?.code === "42703") result = await db.from("plans").select("key, name, active, sort_order, features, limits, metadata").order("sort_order", { ascending: true }).order("key", { ascending: true })
  if (result.error) throw result.error
  return result.data || []
}

async function referencedPlanKeys(db: any) {
  const { data, error } = await db.from("workspace_subscriptions").select("plan_key, scheduled_plan_key, status")
  if (error) throw error
  const referenced = new Set<string>()
  const active = new Set<string>()
  for (const row of data || []) {
    for (const key of [row.plan_key, row.scheduled_plan_key]) if (typeof key === "string" && key) referenced.add(key)
    if (row.status !== "canceled") for (const key of [row.plan_key, row.scheduled_plan_key]) if (typeof key === "string" && key) active.add(key)
  }
  return { referenced, active }
}

function parsePlanDefinition(input: CreatePlatformPlanInput | UpdatePlatformPlanInput, active = true): { plan: ProductPlan } | { error: string } {
  if (!validPlanReason(input.reason)) return { error: "Add a short reason for this plan change." }
  try {
    const candidate = {
      key: input.key.trim(),
      name: input.name.trim(),
      ...(input.description === null || input.description === undefined ? {} : { description: input.description.trim() }),
      active,
      ...(input.recommended === undefined ? {} : { recommended: input.recommended }),
      sort_order: input.sortOrder,
      features: input.features === undefined ? {} : input.features,
      limits: input.limits === undefined ? {} : input.limits,
      metadata: input.metadata === undefined ? {} : input.metadata,
    }
    validatePlanDefinition(candidate)
    return { plan: normalizeProductPlan(candidate) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The plan definition is invalid." }
  }
}

export async function listPlatformPlans(): Promise<PlatformPlanRecord[]> {
  await requirePlatformRole()
  const db = service()
  const [rows, references] = await Promise.all([listPlanRows(db), referencedPlanKeys(db)])
  return rows.map((row: any) => ({
    key: String(row.key),
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : null,
    active: row.active === true,
    sort_order: Number(row.sort_order),
    features: objectValue(row.features),
    limits: objectValue(row.limits),
    metadata: objectValue(row.metadata),
    referenced: references.referenced.has(row.key),
  })) as PlatformPlanRecord[]
}

export async function createPlatformPlan(input: CreatePlatformPlanInput): Promise<PlatformPlanActionResult> {
  const { access } = await requirePlatformBillingAccess()
  const parsed = parsePlanDefinition(input)
  if ("error" in parsed) return { success: false, message: parsed.error }
  const db = service()
  try {
    const existing = await readPlatformPlan(db, parsed.plan.key)
    if (existing) return { success: false, message: "A plan with that key already exists." }
    const { error } = await db.from("plans").insert(planRowFromDefinition(parsed.plan))
    if (error) return { success: false, message: planMutationError(error, "The plan could not be created.") }
    await audit({ actorUserId: access.userId, action: "plan.created", entityType: "plan", entityId: parsed.plan.key, after: planAuditValue(parsed.plan) as Record<string, unknown>, reason: input.reason.trim() })
    return { success: true, message: "Plan created as an active catalog entry.", planKey: parsed.plan.key }
  } catch (error) {
    return { success: false, message: planMutationError(error, "The plan could not be created.") }
  }
}

export async function updatePlatformPlan(input: UpdatePlatformPlanInput): Promise<PlatformPlanActionResult> {
  const { access } = await requirePlatformBillingAccess()
  if (!validPlanReason(input.reason)) return { success: false, message: "Add a short reason for this plan change." }
  const db = service()
  try {
    const current = await readPlatformPlan(db, input.key.trim())
    if (!current) return { success: false, message: "That plan could not be found." }
    const parsed = parsePlanDefinition({ ...input, key: current.key, sortOrder: input.sortOrder ?? current.sort_order, features: input.features ?? current.features, limits: input.limits ?? current.limits, metadata: input.metadata ?? current.metadata, description: input.description === undefined ? current.description : input.description, recommended: input.recommended ?? current.recommended }, current.active)
    if ("error" in parsed) return { success: false, message: parsed.error }
    const { active } = await referencedPlanKeys(db)
    if (active.has(current.key) && hasCommercialPlanChange(current, parsed.plan)) return { success: false, message: "This plan is still used by an active subscription; duplicate it before changing its entitlements." }
    const { error } = await db.from("plans").update({ name: parsed.plan.name, description: parsed.plan.description || null, sort_order: parsed.plan.sort_order, features: parsed.plan.features || {}, limits: parsed.plan.limits || {}, metadata: planRowFromDefinition(parsed.plan).metadata }).eq("key", current.key)
    if (error) return { success: false, message: planMutationError(error, "The plan could not be updated.") }
    await audit({ actorUserId: access.userId, action: "plan.updated", entityType: "plan", entityId: current.key, before: planAuditValue(current) as Record<string, unknown>, after: planAuditValue(parsed.plan) as Record<string, unknown>, reason: input.reason.trim() })
    return { success: true, message: "Plan updated.", planKey: current.key }
  } catch (error) {
    return { success: false, message: planMutationError(error, "The plan could not be updated.") }
  }
}

async function setPlatformPlanActive(key: string, active: boolean, reason: string): Promise<PlatformPlanActionResult> {
  const { access } = await requirePlatformBillingAccess()
  if (!validPlanReason(reason)) return { success: false, message: "Add a short reason for this plan change." }
  const db = service()
  try {
    const current = await readPlatformPlan(db, key.trim())
    if (!current) return { success: false, message: "That plan could not be found." }
    if (current.active === active) return { success: true, message: active ? "Plan is already active." : "Plan is already archived.", planKey: current.key }
    if (!active) {
      const fallback = await getConfiguredFallbackPlanKey(db)
      if (fallback === current.key) return { success: false, message: "The configured fallback plan cannot be archived." }
      const references = await referencedPlanKeys(db)
      if (references.active.has(current.key)) return { success: false, message: "This plan is still used by an active subscription or scheduled change." }
    }
    const { error } = await db.from("plans").update({ active }).eq("key", current.key)
    if (error) return { success: false, message: planMutationError(error, active ? "The plan could not be activated." : "The plan could not be archived.") }
    await audit({ actorUserId: access.userId, action: active ? "plan.activated" : "plan.archived", entityType: "plan", entityId: current.key, before: planAuditValue(current) as Record<string, unknown>, after: { ...planAuditValue(current), active }, reason: reason.trim() })
    return { success: true, message: active ? "Plan activated." : "Plan archived. Historical subscription rows remain intact.", planKey: current.key }
  } catch (error) {
    return { success: false, message: planMutationError(error, active ? "The plan could not be activated." : "The plan could not be archived.") }
  }
}

export async function activatePlatformPlan(key: string, reason: string) {
  return setPlatformPlanActive(key, true, reason)
}

export async function archivePlatformPlan(key: string, reason: string) {
  return setPlatformPlanActive(key, false, reason)
}

export async function duplicatePlatformPlan(input: { sourceKey: string; newKey: string; name?: string; reason: string }): Promise<PlatformPlanActionResult> {
  const { access } = await requirePlatformBillingAccess()
  if (!validPlanReason(input.reason)) return { success: false, message: "Add a short reason for this plan change." }
  const db = service()
  try {
    const source = await readPlatformPlan(db, input.sourceKey.trim())
    if (!source) return { success: false, message: "The source plan could not be found." }
    const existing = await readPlatformPlan(db, input.newKey.trim())
    if (existing) return { success: false, message: "A plan with that key already exists." }
    const duplicate = duplicateProductPlan(source, input.newKey.trim(), input.name?.trim() ? { name: input.name.trim() } : {})
    const { error } = await db.from("plans").insert(planRowFromDefinition(duplicate))
    if (error) return { success: false, message: planMutationError(error, "The plan could not be duplicated.") }
    await audit({ actorUserId: access.userId, action: "plan.duplicated", entityType: "plan", entityId: duplicate.key, before: planAuditValue(source) as Record<string, unknown>, after: planAuditValue(duplicate) as Record<string, unknown>, reason: input.reason.trim(), metadata: { sourcePlanKey: source.key, providerMappingsCopied: false } })
    return { success: true, message: "Plan duplicated as an inactive entry. Add provider mappings before activation.", planKey: duplicate.key }
  } catch (error) {
    return { success: false, message: planMutationError(error, "The plan could not be duplicated.") }
  }
}
export async function savePlatformSetting(key: string, value: unknown, reason: string) { const { access } = await requirePlatformWriteAccess(); if (!/^[a-z][a-z0-9_]{1,80}$/.test(key) || reason.trim().length < 3) return { success: false as const, message: "A valid setting and reason are required." }; const db = service(); const before = await db.from("platform_settings").select("value").eq("key", key).maybeSingle(); const { error } = await db.from("platform_settings").upsert({ key, value, updated_by: access.userId, updated_at: new Date().toISOString() }); if (error) return { success: false as const, message: "The setting could not be saved." }; await audit({ actorUserId: access.userId, action: "setting.updated", entityType: "platform_setting", entityId: key, before: before.data || {}, after: { value }, reason }); return { success: true as const } }
export async function savePlatformMember(input: { userId: string; role: string; status: "active" | "suspended"; reason: string }) { const { access } = await requirePlatformWriteAccess(); if (!input.userId || input.reason.trim().length < 3) return { success: false as const, message: "A user and reason are required." }; const allowed = ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"]; if (!allowed.includes(input.role)) return { success: false as const, message: "That platform role is not valid." }; const { error } = await service().from("platform_members").upsert({ user_id: input.userId, role: input.role, status: input.status, created_by: access.userId, updated_at: new Date().toISOString() }); if (error) return { success: false as const, message: "Platform access could not be saved." }; await audit({ actorUserId: access.userId, action: "platform_member.updated", entityType: "platform_member", entityId: input.userId, after: input, reason: input.reason }); return { success: true as const } }
export async function searchPlatformEntities(query: string) {
  const value = query.trim().slice(0, 120)
  if (value.length < 2) return { groups: [] }
  const [workspaces, users, domains] = await Promise.all([listPlatformWorkspaces(value), listPlatformUsers(value), listPlatformDomains()])
  const groups = [
    { type: "Workspaces", items: workspaces.slice(0, 8).map((row: any) => ({ id: row.id, title: row.name, subtitle: row.slug, href: `/platform/workspaces?query=${encodeURIComponent(row.slug)}` })) },
    { type: "Users", items: users.slice(0, 8).map((row: any) => ({ id: row.user_id, title: row.user_label, subtitle: [row.user_email, row.role_label, row.workspace_label].filter(Boolean).join(" · "), href: `/platform/users?query=${encodeURIComponent(row.user_email || row.user_label)}` })) },
    { type: "Domains", items: domains.filter((row: any) => row.hostname.toLowerCase().includes(value.toLowerCase())).slice(0, 8).map((row: any) => ({ id: row.id, title: row.hostname, subtitle: row.status, href: "/platform/domains" })) },
  ]
  return { groups: groups.filter((group) => group.items.length) }
}
