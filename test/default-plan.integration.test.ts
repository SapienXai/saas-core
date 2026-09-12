import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && anonKey && serviceRoleKey ? describe : describe.skip

integration("configured product default plan", () => {
  const service = url && serviceRoleKey ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null
  let owner: { id: string; email: string }
  let ownerClient: SupabaseClient
  const workspaceIds: string[] = []

  const catalog: Array<{ key: string; name: string; sort_order: number; active: boolean; features: Record<string, boolean>; limits: Record<string, number | null>; metadata: Record<string, unknown> }> = [
    { key: "scale", name: "Scale", sort_order: 0, active: true, features: {}, limits: { "core.workspaces": 4 }, metadata: { fixture: true } },
    { key: "hobby", name: "Hobby", sort_order: 99, active: true, features: {}, limits: { "core.workspaces": 3 }, metadata: { fixture: true } },
  ]

  async function sync(defaultPlanKey: string | null, plans = catalog) {
    return service!.rpc("sync_core_catalog", {
      target_plans: plans,
      target_default_plan_key: defaultPlanKey,
      target_deactivate_missing: false,
    })
  }

  beforeAll(async () => {
    const stamp = Date.now()
    owner = { id: "", email: `core-default-plan-${stamp}@example.test` }
    const created = await service!.auth.admin.createUser({ email: owner.email, password: "CoreDefault!2026-password", email_confirm: true })
    if (created.error || !created.data.user) throw created.error || new Error("Could not create default-plan test account.")
    owner.id = created.data.user.id
    ownerClient = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const session = await ownerClient.auth.signInWithPassword({ email: owner.email, password: "CoreDefault!2026-password" })
    if (session.error) throw session.error
    const prepared = await sync("hobby")
    if (prepared.error) throw prepared.error
  })

  afterAll(async () => {
    for (const id of workspaceIds) await service!.from("workspaces").delete().eq("id", id)
    await sync("core-test", [{ key: "core-test", name: "Core test", sort_order: 10, active: true, features: { team: true }, limits: { "core.workspaces": 2, "core.members": 10 }, metadata: { fixture: true } }])
    if (owner?.id) await service!.auth.admin.deleteUser(owner.id)
  })

  it("requires an explicit existing active default plan", async () => {
    const missing = await sync(null)
    expect(missing.error?.message).toContain("DEFAULT_PLAN_INVALID")

    const inactive = await sync("hobby", catalog.map((plan) => plan.key === "hobby" ? { ...plan, active: false } : plan))
    expect(inactive.error?.message).toContain("DEFAULT_PLAN_INVALID")

    const missingWorkspaceLimit = await sync("hobby", catalog.map((plan) => plan.key === "hobby" ? { ...plan, limits: {} } : plan))
    expect(missingWorkspaceLimit.error?.message).toContain("CORE_WORKSPACE_LIMIT_NOT_CONFIGURED")

    const nonexistent = await sync("missing")
    expect(nonexistent.error?.message).toContain("DEFAULT_PLAN_INVALID")

    const restored = await sync("hobby")
    expect(restored.error).toBeNull()

    const directInsert = await ownerClient.from("workspaces").insert({ name: "Direct insert must fail", slug: `direct-insert-${Date.now()}`, created_by: owner.id })
    expect(directInsert.error).toBeTruthy()
  })

  it("uses the configured default independent of sort order and keeps old subscriptions stable", async () => {
    for (const label of ["A", "B", "C"]) {
      const result = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Default ${label} ${Date.now()}`, target_workspace_slug: `default-${label.toLowerCase()}-${Date.now()}` })
      expect(result.error).toBeNull()
      const id = result.data?.[0]?.workspace_id
      if (!id) throw new Error("Default-plan workspace bootstrap returned no workspace id.")
      workspaceIds.push(id)
      const subscription = await service!.from("workspace_subscriptions").select("plan_key").eq("workspace_id", id).single()
      expect(subscription.data?.plan_key).toBe("hobby")
      const workspace = await service!.from("workspaces").select("onboarding_completed_at").eq("id", id).single()
      expect(workspace.data?.onboarding_completed_at).toBeTruthy()
    }

    const blocked = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Default D ${Date.now()}`, target_workspace_slug: `default-d-${Date.now()}` })
    expect(blocked.error?.message).toContain("WORKSPACE_LIMIT_REACHED")

    const changed = await sync("scale")
    expect(changed.error).toBeNull()
    const future = await ownerClient.rpc("bootstrap_initial_workspace", { target_workspace_name: `Default E ${Date.now()}`, target_workspace_slug: `default-e-${Date.now()}` })
    expect(future.error).toBeNull()
    const futureId = future.data?.[0]?.workspace_id
    if (!futureId) throw new Error("Future default-plan workspace bootstrap returned no workspace id.")
    workspaceIds.push(futureId)

    const subscriptions = await service!.from("workspace_subscriptions").select("workspace_id, plan_key").in("workspace_id", workspaceIds)
    expect(subscriptions.error).toBeNull()
    expect(subscriptions.data?.filter((row) => row.workspace_id !== futureId).every((row) => row.plan_key === "hobby")).toBe(true)
    expect(subscriptions.data?.find((row) => row.workspace_id === futureId)?.plan_key).toBe("scale")
  })
})
