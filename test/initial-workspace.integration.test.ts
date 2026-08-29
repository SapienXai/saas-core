import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && anonKey && serviceRoleKey ? describe : describe.skip

integration("deferred initial Workspace provisioning", () => {
  const service = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  const password = "DeferredWorkspace!2026-password"
  const stamp = Date.now()
  const users = [
    { email: `deferred-a-${stamp}@example.test`, id: "" },
    { email: `deferred-b-${stamp}@example.test`, id: "" },
    { email: `deferred-invited-${stamp}@example.test`, id: "" },
    { email: `deferred-race-${stamp}@example.test`, id: "" },
  ]
  const clients: SupabaseClient[] = []
  const workspaceIds: string[] = []

  beforeAll(async () => {
    for (const account of users) {
      const result = await service!.auth.admin.createUser({ email: account.email, password, email_confirm: true })
      if (result.error || !result.data.user) throw result.error || new Error("Could not create deferred-onboarding test account.")
      account.id = result.data.user.id
    }
    for (const account of users) {
      const client = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
      const result = await client.auth.signInWithPassword({ email: account.email, password })
      if (result.error) throw result.error
      clients.push(client)
    }
  })

  afterAll(async () => {
    for (const id of workspaceIds) await service!.from("workspaces").delete().eq("id", id)
    for (const account of users) if (account.id) await service!.auth.admin.deleteUser(account.id)
  })

  it("bootstraps one owner Workspace, generates a unique slug, and reuses it on retry", async () => {
    const name = `Deferred Venue ${stamp}`
    const first = await clients[0].rpc("ensure_initial_workspace", { target_workspace_name: name })
    expect(first.error).toBeNull()
    const firstRow = first.data?.[0]
    expect(firstRow?.workspace_id).toBeTruthy()
    expect(firstRow?.workspace_slug).toMatch(/^deferred-venue-[0-9]+$/)
    workspaceIds.push(firstRow!.workspace_id)

    const retry = await clients[0].rpc("ensure_initial_workspace", { target_workspace_name: "A different retry hint" })
    expect(retry.error).toBeNull()
    expect(retry.data?.[0]).toEqual(firstRow)

    const owned = await service!.from("workspace_members").select("workspace_id, role").eq("user_id", users[0].id)
    expect(owned.error).toBeNull()
    expect(owned.data).toEqual([{ workspace_id: firstRow!.workspace_id, role: "owner" }])
  })

  it("handles Workspace slug collisions on the server", async () => {
    const first = await clients[1].rpc("ensure_initial_workspace", { target_workspace_name: `Deferred Venue ${stamp}` })
    expect(first.error).toBeNull()
    const row = first.data?.[0]
    expect(row?.workspace_id).toBeTruthy()
    expect(row?.workspace_slug).toMatch(/^deferred-venue-[0-9]+-[2-9][0-9]*$/)
    workspaceIds.push(row!.workspace_id)
  })

  it("reuses an invited member's authorized Workspace without creating another", async () => {
    const membership = await service!.from("workspace_members").insert({ workspace_id: workspaceIds[0], user_id: users[2].id, role: "admin" })
    expect(membership.error).toBeNull()
    const result = await clients[2].rpc("ensure_initial_workspace", { target_workspace_name: "Should not rename or create" })
    expect(result.error).toBeNull()
    expect(result.data?.[0]?.workspace_id).toBe(workspaceIds[0])
    const own = await service!.from("workspaces").select("id").eq("created_by", users[2].id)
    expect(own.error).toBeNull()
    expect(own.data).toEqual([])
  })

  it("honors an authorized preferred Workspace without trusting an unverified target", async () => {
    const created = await service!.from("workspaces").insert({ name: `Preferred Workspace ${stamp}`, slug: `preferred-workspace-${stamp}`, created_by: users[0].id, onboarding_completed_at: new Date().toISOString() }).select("id").single()
    expect(created.error).toBeNull()
    const membership = await service!.from("workspace_members").insert({ workspace_id: created.data!.id, user_id: users[0].id, role: "owner" })
    expect(membership.error).toBeNull()
    const result = await clients[0].rpc("ensure_initial_workspace", { target_workspace_name: "Should stay preferred", target_workspace_id: created.data!.id })
    expect(result.error).toBeNull()
    expect(result.data?.[0]?.workspace_id).toBe(created.data!.id)
    workspaceIds.push(created.data!.id)
  })

  it("serializes two first-use requests for the same account", async () => {
    const results = await Promise.all([
      clients[3].rpc("ensure_initial_workspace", { target_workspace_name: `Race Workspace ${stamp}` }),
      clients[3].rpc("ensure_initial_workspace", { target_workspace_name: `Race Workspace ${stamp}` }),
    ])
    expect(results[0].error).toBeNull()
    expect(results[1].error).toBeNull()
    expect(results[0].data?.[0]?.workspace_id).toBe(results[1].data?.[0]?.workspace_id)
    workspaceIds.push(results[0].data![0].workspace_id)
    const count = await service!.from("workspaces").select("id", { count: "exact", head: true }).eq("created_by", users[3].id)
    expect(count.error).toBeNull()
    expect(count.count).toBe(1)
  })

  it("rejects unauthenticated bootstrap attempts", async () => {
    const anonymous = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const result = await anonymous.rpc("ensure_initial_workspace", { target_workspace_name: "Unauthenticated" })
    expect(result.error).not.toBeNull()
    expect(result.error?.message).toMatch(/AUTH_REQUIRED|permission denied/i)
  })
})
