import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { resolveHost as resolveHostService } from "../lib/domains/domain-service"

const url = process.env.SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const integration = url && anonKey && serviceRoleKey ? describe : describe.skip

integration("SaaS Core domain foundation", () => {
  let service: SupabaseClient
  let workspaceA = ""
  let workspaceB = ""
  let siteA = ""
  let siteB = ""
  let domainA = ""
  let domainB = ""
  const workspaceIds: string[] = []
  const userIds: string[] = []
  const stamp = Date.now().toString(36)

  async function createWorkspace(label: string) {
    const slug = "domain-foundation-" + label + "-" + stamp
    const { data, error } = await service
      .from("workspaces")
      .insert({ name: "Domain Foundation " + label, slug, status: "active", platform_status: "active", onboarding_completed_at: new Date().toISOString() })
      .select("id, slug")
      .single()
    if (error || !data) throw error || new Error("Could not create domain fixture workspace.")
    workspaceIds.push(data.id)
    return data
  }

  async function createSite(workspaceId: string, productKey: string) {
    const { data, error } = await service.from("public_sites").insert({ workspace_id: workspaceId, product_key: productKey }).select("id").single()
    if (error || !data) throw error || new Error("Could not create domain fixture public site.")
    return data.id
  }

  async function claim(workspaceId: string, siteId: string, hostname: string, replaceExisting = false) {
    return service.rpc("claim_platform_subdomain", {
      target_workspace_id: workspaceId,
      target_site_id: siteId,
      target_hostname: hostname,
      target_replace_existing: replaceExisting,
    })
  }

  async function resolve(hostname: string) {
    return service.rpc("resolve_domain_host", { target_normalized_hostname: hostname })
  }

  beforeAll(async () => {
    service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const first = await createWorkspace("alpha")
    const second = await createWorkspace("beta")
    workspaceA = first.id
    workspaceB = second.id
    siteA = await createSite(workspaceA, "domain-foundation")
    siteB = await createSite(workspaceB, "domain-foundation")
    const firstClaim = await claim(workspaceA, siteA, "alpha." + stamp + ".example.com")
    const secondClaim = await claim(workspaceB, siteB, "beta." + stamp + ".example.com")
    if (firstClaim.error || secondClaim.error) throw firstClaim.error || secondClaim.error
    domainA = firstClaim.data?.[0]?.domain_id || ""
    domainB = secondClaim.data?.[0]?.domain_id || ""
  })

  afterAll(async () => {
    for (const id of workspaceIds) await service.from("workspaces").delete().eq("id", id)
    for (const id of userIds) await service.auth.admin.deleteUser(id)
  })

  it("resolves only active canonical domains to the owning site and product", async () => {
    const result = await resolve("alpha." + stamp + ".example.com")
    expect(result.error).toBeNull()
    expect(result.data?.[0]).toMatchObject({
      workspace_id: workspaceA,
      site_id: siteA,
      product_key: "domain-foundation",
      domain_id: domainA,
      domain_type: "platform_subdomain",
      is_primary: true,
    })

    const serviceResolution = await resolveHostService("ALPHA." + stamp + ".EXAMPLE.COM:443")
    expect(serviceResolution).toMatchObject({
      workspaceId: workspaceA,
      siteId: siteA,
      productKey: "domain-foundation",
      domainId: domainA,
      normalizedHostname: "alpha." + stamp + ".example.com",
      domainType: "platform_subdomain",
      isPrimary: true,
    })

    const unknown = await resolve("unknown." + stamp + ".example.com")
    expect(unknown.error).toBeNull()
    expect(unknown.data).toEqual([])

    const pending = await service.from("workspace_domains").update({ status: "pending" }).eq("id", domainA)
    expect(pending.error).toBeNull()
    const pendingResolution = await resolve("alpha." + stamp + ".example.com")
    expect(pendingResolution.error).toBeNull()
    expect(pendingResolution.data).toEqual([])

    const failed = await service.from("workspace_domains").update({ status: "failed" }).eq("id", domainA)
    expect(failed.error).toBeNull()
    const failedResolution = await resolve("alpha." + stamp + ".example.com")
    expect(failedResolution.error).toBeNull()
    expect(failedResolution.data).toEqual([])

    const restored = await service.from("workspace_domains").update({ status: "active" }).eq("id", domainA)
    expect(restored.error).toBeNull()
  })

  it("changes one platform address atomically and retires the old hostname", async () => {
    const oldHostname = "alpha." + stamp + ".example.com"
    const newHostname = "renamed-" + stamp + ".example.com"
    const changed = await claim(workspaceA, siteA, newHostname, true)
    expect(changed.error).toBeNull()
    expect(changed.data?.[0]).toMatchObject({ domain_id: domainA, hostname: newHostname, normalized_hostname: newHostname, is_primary: true })

    const oldResolution = await resolve(oldHostname)
    const newResolution = await resolve(newHostname)
    expect(oldResolution.error).toBeNull()
    expect(oldResolution.data).toEqual([])
    expect(newResolution.error).toBeNull()
    expect(newResolution.data?.[0]).toMatchObject({ workspace_id: workspaceA, site_id: siteA, product_key: "domain-foundation", domain_id: domainA })

    const secondChange = await claim(workspaceA, siteA, "second-" + stamp + ".example.com")
    expect(secondChange.error?.message).toContain("PLATFORM_DOMAIN_EXISTS")
  })

  it("serializes competing owners of one normalized hostname", async () => {
    const first = await createWorkspace("race-one")
    const second = await createWorkspace("race-two")
    const firstSite = await createSite(first.id, "domain-foundation")
    const secondSite = await createSite(second.id, "domain-foundation")
    const hostname = "race-" + stamp + ".example.com"
    const results = await Promise.all([
      claim(first.id, firstSite, hostname),
      claim(second.id, secondSite, hostname),
    ])
    const successes = results.filter((result) => !result.error)
    const failures = results.filter((result) => result.error)
    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect(failures[0].error?.message).toContain("DOMAIN_HOSTNAME_CONFLICT")
    const rows = await service.from("workspace_domains").select("workspace_id, site_id").eq("normalized_hostname", hostname)
    expect(rows.error).toBeNull()
    expect(rows.data).toHaveLength(1)
  })

  it("keeps one primary domain per public site", async () => {
    const customHostname = "custom-" + stamp + ".example.net"
    const inserted = await service.from("workspace_domains").insert({
      workspace_id: workspaceA,
      site_id: siteA,
      hostname: customHostname,
      normalized_hostname: customHostname,
      type: "custom",
      status: "active",
      is_primary: false,
      provider: "fixture",
      provider_environment: "production",
      verification_state: "verified",
      provider_verified: true,
      dns_configured: true,
      verified_at: new Date().toISOString(),
    }).select("id").single()
    expect(inserted.error).toBeNull()

    const demoted = await service.from("workspace_domains").update({ is_primary: false }).eq("id", domainA)
    expect(demoted.error).toBeNull()
    const promoted = await service.from("workspace_domains").update({ is_primary: true }).eq("id", inserted.data!.id)
    expect(promoted.error).toBeNull()

    const restored = await claim(workspaceA, siteA, "renamed-" + stamp + ".example.com", true)
    expect(restored.error).toBeNull()
    const primaries = await service.from("workspace_domains").select("id").eq("site_id", siteA).eq("is_primary", true)
    expect(primaries.error).toBeNull()
    expect(primaries.data).toHaveLength(1)
    expect(primaries.data?.[0]?.id).toBe(domainA)

    const rejected = await service.from("workspace_domains").update({ is_primary: true }).eq("id", inserted.data!.id)
    expect(rejected.error).not.toBeNull()
  })

  it("protects public sites and domains across workspace RLS boundaries", async () => {
    const password = "DomainRls!2026-password"
    const first = await service.auth.admin.createUser({ email: "domain-rls-a-" + stamp + "@example.test", password, email_confirm: true })
    const second = await service.auth.admin.createUser({ email: "domain-rls-b-" + stamp + "@example.test", password, email_confirm: true })
    if (first.error || !first.data.user || second.error || !second.data.user) throw first.error || second.error || new Error("Could not create domain RLS users.")
    userIds.push(first.data.user.id, second.data.user.id)
    const membershipA = await service.from("workspace_members").insert({ workspace_id: workspaceA, user_id: first.data.user.id, role: "owner" })
    const membershipB = await service.from("workspace_members").insert({ workspace_id: workspaceB, user_id: second.data.user.id, role: "owner" })
    expect(membershipA.error).toBeNull()
    expect(membershipB.error).toBeNull()

    const clientA = createClient(url!, anonKey!, { auth: { persistSession: false, autoRefreshToken: false } })
    const signedIn = await clientA.auth.signInWithPassword({ email: "domain-rls-a-" + stamp + "@example.test", password })
    expect(signedIn.error).toBeNull()

    const siteRead = await clientA.from("public_sites").select("id").eq("id", siteB).maybeSingle()
    expect(siteRead.error).toBeNull()
    expect(siteRead.data).toBeNull()

    const domainRead = await clientA.from("workspace_domains").select("id").eq("id", domainB).maybeSingle()
    expect(domainRead.error).toBeNull()
    expect(domainRead.data).toBeNull()

    const siteWrite = await clientA.from("public_sites").update({ product_key: "not-owner" }).eq("id", siteB).select("id")
    expect(siteWrite.error).not.toBeNull()

    const domainWrite = await clientA.from("workspace_domains").update({ hostname: "spoofed-" + stamp + ".example.com" }).eq("id", domainB).select("id")
    expect(domainWrite.error).not.toBeNull()

    const ownSiteWrite = await clientA.from("public_sites").update({ product_key: "not-owner" }).eq("id", siteA).select("id")
    expect(ownSiteWrite.error).not.toBeNull()
    const ownDomainWrite = await clientA.from("workspace_domains").update({ hostname: "spoofed-" + stamp + ".example.com" }).eq("id", domainA).select("id")
    expect(ownDomainWrite.error).not.toBeNull()

    const unchanged = await service.from("public_sites").select("product_key").in("id", [siteA, siteB]).order("id")
    expect(unchanged.data?.map((row) => row.product_key)).toEqual(["domain-foundation", "domain-foundation"])

    const clientRpc = await clientA.rpc("resolve_domain_host", { target_normalized_hostname: "beta." + stamp + ".example.com" })
    expect(clientRpc.error).not.toBeNull()
  })
})
