import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && anonKey && serviceRoleKey ? describe : describe.skip

integration("clean Core tenancy and RLS", () => {
  const service = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  let owner: { id: string; email: string }
  let member: { id: string; email: string }
  let ownerClient: SupabaseClient
  let memberClient: SupabaseClient
  let workspaceId = ""
  let secondWorkspaceId = ""

  beforeAll(async () => {
    const stamp = Date.now()
    owner = { id: "", email: `core-owner-${stamp}@example.test` }
    member = { id: "", email: `core-member-${stamp}@example.test` }
    for (const account of [owner, member]) {
      const result = await service!.auth.admin.createUser({ email: account.email, password: "CoreRls!2026-password", email_confirm: true })
      if (result.error || !result.data.user) throw result.error || new Error("Could not create local test account.")
      account.id = result.data.user.id
    }
    ownerClient = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    memberClient = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const [ownerSession, memberSession] = await Promise.all([
      ownerClient.auth.signInWithPassword({ email: owner.email, password: "CoreRls!2026-password" }),
      memberClient.auth.signInWithPassword({ email: member.email, password: "CoreRls!2026-password" }),
    ])
    if (ownerSession.error || memberSession.error) throw ownerSession.error || memberSession.error
    const configured = await service!.rpc("sync_core_catalog", {
      target_plans: [{ key: "core-test", name: "Core test", sort_order: 10, active: true, features: { team: true, domains: true, pwa: true, push: true }, limits: { "core.workspaces": 2, "core.members": 10, projects: 100 }, metadata: { fixture: true } }],
      target_default_plan_key: "core-test",
      target_deactivate_missing: false,
    })
    if (configured.error) throw configured.error
    const bootstrap = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Core RLS ${stamp}`, target_workspace_slug: `core-rls-${stamp}` })
    if (bootstrap.error || !bootstrap.data?.[0]) throw bootstrap.error || new Error("Workspace bootstrap failed.")
    workspaceId = bootstrap.data[0].workspace_id
  })

  afterAll(async () => {
    for (const id of [workspaceId, secondWorkspaceId]) if (id) await service!.from("workspaces").delete().eq("id", id)
    for (const account of [owner, member]) if (account?.id) await service!.auth.admin.deleteUser(account.id)
  })

  it("isolates workspace rows and protects platform records", async () => {
    const ownerWorkspace = await ownerClient.from("workspaces").select("id, name").eq("id", workspaceId).maybeSingle()
    expect(ownerWorkspace.error).toBeNull()
    expect(ownerWorkspace.data?.id).toBe(workspaceId)

    const memberWorkspace = await memberClient.from("workspaces").select("id").eq("id", workspaceId).maybeSingle()
    expect(memberWorkspace.error).toBeNull()
    expect(memberWorkspace.data).toBeNull()

    const platformRead = await ownerClient.from("platform_settings").select("key").limit(1)
    expect(platformRead.error).not.toBeNull()
  })

  it("allows multiple owned workspaces until the explicit entitlement limit", async () => {
    const second = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Core RLS Second ${Date.now()}`, target_workspace_slug: `core-rls-second-${Date.now()}` })
    expect(second.error).toBeNull()
    secondWorkspaceId = second.data?.[0]?.workspace_id || ""
    expect(secondWorkspaceId).toBeTruthy()

    const third = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Core RLS Third ${Date.now()}`, target_workspace_slug: `core-rls-third-${Date.now()}` })
    expect(third.error?.message).toContain("WORKSPACE_LIMIT_REACHED")

    const memberCannotSeeSecond = await memberClient.from("workspaces").select("id").eq("id", secondWorkspaceId).maybeSingle()
    expect(memberCannotSeeSecond.error).toBeNull()
    expect(memberCannotSeeSecond.data).toBeNull()
  })

  it("accepts a one-use invitation without widening tenant access", async () => {
    const tokenHash = `integration-token-${Date.now()}`
    const invitation = await ownerClient.rpc("create_workspace_invitation", {
      target_workspace_id: workspaceId,
      target_email: member.email,
      target_role: "readonly",
      target_token_hash: tokenHash,
    })
    expect(invitation.error).toBeNull()
    const accepted = await memberClient.rpc("accept_workspace_invitation", { target_token_hash: tokenHash })
    expect(accepted.error).toBeNull()
    expect(accepted.data?.[0]?.workspace_id).toBe(workspaceId)

    const visibleWorkspace = await memberClient.from("workspaces").select("id").eq("id", workspaceId).maybeSingle()
    expect(visibleWorkspace.error).toBeNull()
    expect(visibleWorkspace.data?.id).toBe(workspaceId)

    const replay = await memberClient.rpc("accept_workspace_invitation", { target_token_hash: tokenHash })
    expect(replay.error).not.toBeNull()
  })
})
