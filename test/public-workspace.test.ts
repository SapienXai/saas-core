import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { createServiceRoleClient } = vi.hoisted(() => ({ createServiceRoleClient: vi.fn() }))
vi.mock("@/lib/supabase", () => ({ createServiceRoleClient }))

import { resolvePublicWorkspace, resolvePublicWorkspaceRequest } from "../lib/public-workspace"

const workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  slug: "acme",
  status: "active",
  platform_status: "active",
}

function builder(response: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => response),
  }
  return chain
}

function useResponses(...responses: unknown[]) {
  let index = 0
  const service = {
    from: vi.fn(() => builder(responses[index++] ?? { data: null, error: null })),
  }
  createServiceRoleClient.mockReturnValue(service)
  return service
}

const originalRoot = process.env.SAAS_CORE_ROOT_DOMAIN

beforeEach(() => {
  process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
  createServiceRoleClient.mockReset()
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.SAAS_CORE_ROOT_DOMAIN
  else process.env.SAAS_CORE_ROOT_DOMAIN = originalRoot
})

describe("public Workspace resolution", () => {
  it("resolves a hosted Workspace by exact slug and passes only the normalized path", async () => {
    useResponses({ data: workspace, error: null })

    const result = await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example?workspace=other" })
    expect(result).toEqual({
      status: "resolved",
      context: {
        workspaceId: workspace.id,
        workspaceSlug: "acme",
        workspaceName: "Acme",
        hostname: "acme.example.com",
        hostnameKind: "HOSTED_WORKSPACE",
        pathname: "/example",
      },
    })
  })

  it("fails closed for unknown or non-public hosted Workspaces", async () => {
    useResponses({ data: null, error: null })
    expect(await resolvePublicWorkspace({ hostname: "unknown.example.com", pathname: "/beach" })).toEqual({ status: "not_found" })

    useResponses({ data: { ...workspace, platform_status: "suspended" }, error: null })
    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "not_found" })
  })

  it("distinguishes hosted Workspace misses from database failures", async () => {
    useResponses({ data: null, error: { message: "database unavailable" } })
    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "unavailable" })

    createServiceRoleClient.mockImplementationOnce(() => {
      throw new Error("service role unavailable")
    })
    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "unavailable" })
  })

  it("returns unavailable when the hosted Workspace query throws", async () => {
    const service = {
      from: vi.fn(() => {
        const chain = builder({ data: null, error: null })
        chain.maybeSingle = vi.fn(async () => {
          throw new Error("query transport failure")
        })
        return chain
      }),
    }
    createServiceRoleClient.mockReturnValue(service)

    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "unavailable" })
  })

  it("requires a persisted active, verified, configured custom domain and active Workspace", async () => {
    const domain = {
      workspace_id: workspace.id,
      status: "active",
      provider_environment: "production",
      verification_state: "verified",
      provider_verified: true,
      dns_configured: true,
      verified_at: "2026-08-28T00:00:00.000Z",
    }
    useResponses({ data: domain, error: null }, { data: workspace, error: null })
    const resolved = await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })
    expect(resolved).toMatchObject({
      status: "resolved",
      context: { workspaceId: workspace.id, workspaceSlug: "acme", pathname: "/example", hostnameKind: "CUSTOM_WORKSPACE" },
    })

    useResponses({ data: { ...domain, verification_state: "pending" }, error: null })
    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "not_found" })
  })

  it("distinguishes custom-domain misses from domain and Workspace database failures", async () => {
    useResponses({ data: null, error: { message: "domain database unavailable" } })
    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "unavailable" })

    useResponses({ data: { workspace_id: workspace.id }, error: null }, { data: null, error: { message: "Workspace database unavailable" } })
    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "unavailable" })

    createServiceRoleClient.mockImplementationOnce(() => {
      throw new Error("custom-domain service unavailable")
    })
    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "unavailable" })

    useResponses({ data: { workspace_id: workspace.id }, error: null }, { data: { ...workspace, status: "suspended" }, error: null })
    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "not_found" })
  })

  it("returns unavailable when the custom-domain query throws", async () => {
    const service = {
      from: vi.fn(() => {
        const chain = builder({ data: null, error: null })
        chain.maybeSingle = vi.fn(async () => {
          throw new Error("domain query transport failure")
        })
        return chain
      }),
    }
    createServiceRoleClient.mockReturnValue(service)

    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "unavailable" })
  })

  it("returns the same logical context for hosted and custom hostnames", async () => {
    useResponses({ data: workspace, error: null })
    const hosted = await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })
    useResponses({ data: { workspace_id: workspace.id }, error: null }, { data: workspace, error: null })
    const custom = await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })

    expect(hosted.status).toBe("resolved")
    expect(custom.status).toBe("resolved")
    if (hosted.status === "resolved" && custom.status === "resolved") {
      expect(custom.context.workspaceId).toBe(hosted.context.workspaceId)
      expect(custom.context.workspaceSlug).toBe(hosted.context.workspaceSlug)
      expect(custom.context.pathname).toBe(hosted.context.pathname)
    }
  })

  it("does not resolve platform, local, reserved, or canonical app surfaces", async () => {
    for (const input of [
      { hostname: "example.com", pathname: "/beach" },
      { hostname: "app.example.com", pathname: "/beach" },
      { hostname: "acme.localhost:3000", pathname: "/example" },
      { hostname: "acme.example.com", pathname: "/app" },
      { hostname: "acme.example.com", pathname: "/api/health" },
    ]) {
      expect(await resolvePublicWorkspace(input)).toEqual({ status: "not_public_workspace" })
    }
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it("uses the shared trusted request hostname and ignores tenant query overrides", async () => {
    useResponses({ data: workspace, error: null })
    const request = new Request("https://0.0.0.0:3000/beach?workspaceId=another", {
      headers: { host: "acme.example.com" },
    })
    const result = await resolvePublicWorkspaceRequest(request)
    expect(result).toMatchObject({ status: "resolved", context: { workspaceId: workspace.id, pathname: "/beach" } })
  })

  it("propagates operational failures through the request wrapper without exposing details", async () => {
    useResponses({ data: null, error: { message: "private database detail" } })
    const request = new Request("https://0.0.0.0:3000/beach", {
      headers: { host: "acme.example.com" },
    })

    await expect(resolvePublicWorkspaceRequest(request)).resolves.toEqual({ status: "unavailable" })
  })
})
