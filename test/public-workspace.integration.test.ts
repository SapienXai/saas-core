import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolvePublicWorkspace } from "../lib/public-workspace"

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && serviceRoleKey ? describe : describe.skip

integration("public Workspace routing against Core persistence", () => {
  let service: SupabaseClient
  const suffix = Date.now().toString(36)
  const workspaceA = `routing-alpha-${suffix}`
  const workspaceB = `routing-beta-${suffix}`
  const rootDomain = process.env.SAAS_CORE_ROOT_DOMAIN || "saas.example.com"
  const customA = `${workspaceA}.customer.example`
  const customB = `${workspaceB}.customer.example`
  const ids: string[] = []

  beforeAll(async () => {
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    for (const [name, slug] of [["Routing Alpha", workspaceA], ["Routing Beta", workspaceB]]) {
      const { data, error } = await service
        .from("workspaces")
        .insert({ name, slug, status: "active", platform_status: "active", onboarding_completed_at: new Date().toISOString() })
        .select("id")
        .single()
      if (error || !data) throw new Error(error?.message || "Could not create routing fixture Workspace.")
      ids.push(data.id)
    }
    const { error } = await service.from("workspace_domains").insert([
      {
        workspace_id: ids[0], hostname: customA, status: "active", provider: "fixture",
        provider_environment: "production", verification_state: "verified", provider_verified: true,
        dns_configured: true, verified_at: new Date().toISOString(),
      },
      {
        workspace_id: ids[1], hostname: customB, status: "active", provider: "fixture",
        provider_environment: "production", verification_state: "verified", provider_verified: true,
        dns_configured: true, verified_at: new Date().toISOString(),
      },
    ])
    if (error) throw new Error(error.message)
  })

  afterAll(async () => {
    if (ids.length) await service.from("workspaces").delete().in("id", ids)
  })

  it("resolves hosted and custom hosts to the same Workspace/path context", async () => {
    const hosted = await resolvePublicWorkspace({ hostname: `${workspaceA}.${rootDomain}`, pathname: "/beach?ref=instagram" })
    const custom = await resolvePublicWorkspace({ hostname: customA, pathname: "/beach" })

    expect(hosted).toMatchObject({ status: "resolved", context: { workspaceId: ids[0], workspaceSlug: workspaceA, pathname: "/beach", hostnameKind: "HOSTED_WORKSPACE" } })
    expect(custom).toMatchObject({ status: "resolved", context: { workspaceId: ids[0], workspaceSlug: workspaceA, pathname: "/beach", hostnameKind: "CUSTOM_WORKSPACE" } })
  })

  it("cannot be overridden by path or query parameters", async () => {
    const result = await resolvePublicWorkspace({ hostname: `${workspaceA}.${rootDomain}`, pathname: `/${workspaceB}/beach?workspaceId=${ids[1]}` })
    expect(result).toMatchObject({ status: "resolved", context: { workspaceId: ids[0], workspaceSlug: workspaceA, pathname: `/${workspaceB}/beach` } })
  })

  it("fails closed for unknown, pending, removed, and non-public domains or Workspaces", async () => {
    expect(await resolvePublicWorkspace({ hostname: "unknown.customer.example", pathname: "/example" })).toEqual({ status: "not_found" })

    const { error: pendingError } = await service.from("workspace_domains").update({ status: "verifying", verification_state: "pending", provider_verified: false, dns_configured: false, verified_at: null }).eq("hostname", customA)
    if (pendingError) throw new Error(pendingError.message)
    expect(await resolvePublicWorkspace({ hostname: customA, pathname: "/example" })).toEqual({ status: "not_found" })

    const { error: restoreDomainError } = await service.from("workspace_domains").update({ status: "active", verification_state: "verified", provider_verified: true, dns_configured: true, verified_at: new Date().toISOString() }).eq("hostname", customA)
    if (restoreDomainError) throw new Error(restoreDomainError.message)
    const { error: suspendError } = await service.from("workspaces").update({ platform_status: "suspended" }).eq("id", ids[0])
    if (suspendError) throw new Error(suspendError.message)
    expect(await resolvePublicWorkspace({ hostname: `${workspaceA}.${rootDomain}`, pathname: "/example" })).toEqual({ status: "not_found" })
    const { error: restoreWorkspaceError } = await service.from("workspaces").update({ platform_status: "active" }).eq("id", ids[0])
    if (restoreWorkspaceError) throw new Error(restoreWorkspaceError.message)
  })

  it("does not resolve platform or canonical Core paths", async () => {
    expect(await resolvePublicWorkspace({ hostname: `${workspaceA}.${rootDomain}`, pathname: "/app/../app" })).toEqual({ status: "not_public_workspace" })
    expect(await resolvePublicWorkspace({ hostname: `app.${rootDomain}`, pathname: "/example" })).toEqual({ status: "not_public_workspace" })
    expect(await resolvePublicWorkspace({ hostname: "workspace.localhost:3000", pathname: "/example" })).toEqual({ status: "not_public_workspace" })
  })
})
