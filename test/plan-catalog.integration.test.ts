import { createClient } from "@supabase/supabase-js"
import { afterAll, describe, expect, it } from "vitest"

const url = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY
const integration = url && serviceRoleKey && anonKey ? describe : describe.skip
const service = url && serviceRoleKey && anonKey
  ? createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null
const anonymous = url && serviceRoleKey && anonKey
  ? createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

integration("plan catalog lifecycle schema", () => {
  const planKey = `catalog_fixture_${Date.now()}`
  const workspaceSlug = `${planKey.replaceAll("_", "-")}-workspace`
  let workspaceId = ""

  afterAll(async () => {
    if (workspaceId) await service!.from("workspaces").delete().eq("id", workspaceId)
    await service!.from("plans").delete().eq("key", planKey)
  })

  it("supports archive/activate while protecting referenced entitlement history", async () => {
    const inserted = await service!.from("plans").insert({
      key: planKey,
      name: "Catalog fixture",
      description: "Initial catalog copy",
      sort_order: 900,
      active: true,
      features: { exports: true },
      limits: { "core.workspaces": 1, items: 2 },
      metadata: { fixture: true },
    }).select("key, description, active").single()
    expect(inserted.error).toBeNull()
    expect(inserted.data).toMatchObject({ key: planKey, description: "Initial catalog copy", active: true })

    const archived = await service!.from("plans").update({ active: false }).eq("key", planKey)
    expect(archived.error).toBeNull()
    const activated = await service!.from("plans").update({ active: true }).eq("key", planKey)
    expect(activated.error).toBeNull()

    const workspace = await service!.from("workspaces").insert({ name: "Catalog fixture workspace", slug: workspaceSlug, status: "active" }).select("id").single()
    expect(workspace.error).toBeNull()
    workspaceId = workspace.data?.id || ""
    expect(workspaceId).toBeTruthy()
    const bound = await service!.from("workspace_subscriptions").update({ plan_key: planKey, status: "active", source: "manual" }).eq("workspace_id", workspaceId)
    expect(bound.error).toBeNull()

    const additiveExpansion = await service!.from("plans").update({
      features: { exports: true, analytics: true },
      limits: { "core.workspaces": 1, items: 2, device_slots: 3 },
    }).eq("key", planKey)
    expect(additiveExpansion.error).toBeNull()

    const commercialEdit = await service!.from("plans").update({ limits: { "core.workspaces": 1, items: 1, device_slots: 3 } }).eq("key", planKey)
    expect(commercialEdit.error?.message).toContain("PLAN_REFERENCED_IMMUTABLE")
    const presentationEdit = await service!.from("plans").update({ name: "Catalog fixture renamed", description: "Updated catalog copy" }).eq("key", planKey)
    expect(presentationEdit.error).toBeNull()

    const archiveWhileActive = await service!.from("plans").update({ active: false }).eq("key", planKey)
    expect(archiveWhileActive.error?.message).toContain("PLAN_REFERENCED_ACTIVE")

    const canceled = await service!.from("workspace_subscriptions").update({ status: "canceled" }).eq("workspace_id", workspaceId)
    expect(canceled.error).toBeNull()
    const archiveAfterEnd = await service!.from("plans").update({ active: false }).eq("key", planKey)
    expect(archiveAfterEnd.error).toBeNull()
    const historical = await service!.from("workspace_subscriptions").select("plan_key, status").eq("workspace_id", workspaceId).single()
    expect(historical.data).toMatchObject({ plan_key: planKey, status: "canceled" })

    const unauthorized = await anonymous!.from("plans").insert({ key: `${planKey}_client`, name: "Should fail", sort_order: 1 })
    expect(unauthorized.error).toBeTruthy()
  })
})
