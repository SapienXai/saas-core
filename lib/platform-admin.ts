import "server-only"

import { requirePlatformRole, requirePlatformWriteAccess } from "@/lib/platform-authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { audit } from "@/lib/platform-audit"
import { formatPlatformRole } from "@/lib/platform-types"

const service = () => createServiceRoleClient() as any
export async function getPlatformOverview() {
  const { role } = await requirePlatformRole(); const db = service()
  const [workspaces, users, subscriptions, domains, events] = await Promise.all([
    db.from("workspaces").select("id", { count: "exact", head: true }), db.from("workspace_members").select("user_id", { count: "exact", head: true }), db.from("workspace_subscriptions").select("id", { count: "exact", head: true }), db.from("workspace_domains").select("id", { count: "exact", head: true }), db.from("platform_audit_logs").select("id", { count: "exact", head: true }).gte("created_at", new Date(Date.now() - 86400000).toISOString()),
  ])
  return { role, counts: { workspaces: workspaces.count || 0, users: users.count || 0, subscriptions: subscriptions.count || 0, domains: domains.count || 0, events24h: events.count || 0 } }
}
export async function listPlatformWorkspaces(query = "") { await requirePlatformRole(); const db = service(); let request = db.from("workspaces").select("id, name, slug, status, created_at").order("created_at", { ascending: false }).limit(100); if (query) request = request.or(`name.ilike.%${query}%,slug.ilike.%${query}%`); const { data, error } = await request; if (error) throw new Error(error.message); return data || [] }
export async function listPlatformUsers(query = "") {
  await requirePlatformRole()
  const db = service()
  const { data, error } = await db.from("workspace_members").select("user_id, workspace_id, role, created_at").order("created_at", { ascending: false }).limit(100)
  if (error) throw new Error(error.message)

  const rows = data || []
  const workspaceIds = [...new Set(rows.map((row: any) => row.workspace_id).filter(Boolean))]
  const [workspaceResult, authResult] = await Promise.all([
    workspaceIds.length ? db.from("workspaces").select("id, name, slug").in("id", workspaceIds) : Promise.resolve({ data: [], error: null }),
    db.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ])

  if (workspaceResult.error) console.error("Error resolving platform workspace labels:", workspaceResult.error.message)
  if (authResult.error) console.error("Error resolving platform user labels:", authResult.error.message)

  const workspaces = new Map<string, any>((workspaceResult.data || []).map((workspace: any) => [workspace.id, workspace]))
  const users = new Map<string, any>((authResult.data?.users || []).map((user: any) => [user.id, user]))
  const enriched = rows.map((row: any) => {
    const user = users.get(row.user_id)
    const metadata = user?.user_metadata && typeof user.user_metadata === "object" ? user.user_metadata : {}
    const name = [metadata.full_name, metadata.name, metadata.display_name, metadata.username, metadata.preferred_username]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0)
      ?.trim() || null
    const email = typeof user?.email === "string" && user.email.trim() ? user.email.trim() : null
    const workspace = workspaces.get(row.workspace_id)
    const workspaceName = typeof workspace?.name === "string" && workspace.name.trim() ? workspace.name.trim() : null
    const workspaceSlug = typeof workspace?.slug === "string" && workspace.slug.trim() ? workspace.slug.trim() : null
    return {
      ...row,
      user_label: name || email || "Unknown user",
      user_email: name && email ? email : null,
      workspace_label: workspaceName || workspaceSlug || "Unknown workspace",
      workspace_slug: workspaceName && workspaceSlug ? workspaceSlug : null,
      role_label: formatPlatformRole(row.role),
    }
  })

  const value = query.trim().toLowerCase()
  if (!value) return enriched
  return enriched.filter((row: any) => [row.user_id, row.user_label, row.user_email, row.workspace_id, row.workspace_label, row.workspace_slug, row.role, row.role_label]
    .filter((field) => typeof field === "string")
    .some((field) => field.toLowerCase().includes(value)))
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
export async function listPlatformPlans() { await requirePlatformRole(); const { data, error } = await service().from("plans").select("key, name, active, sort_order, features, limits, metadata").order("sort_order"); if (error) throw new Error(error.message); return data || [] }
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
