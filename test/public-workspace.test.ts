import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { resolveHost } = vi.hoisted(() => ({ resolveHost: vi.fn() }))
vi.mock("@/lib/domains/domain-service", () => ({ resolveHost }))

import { resolvePublicWorkspace, resolvePublicWorkspaceRequest } from "../lib/public-workspace"

const workspace = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme",
  slug: "acme",
}

function resolution(hostname: string, overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: workspace.id,
    siteId: "22222222-2222-4222-8222-222222222222",
    productKey: "saas-core",
    domainId: "33333333-3333-4333-8333-333333333333",
    hostname,
    normalizedHostname: hostname,
    domainType: "platform_subdomain",
    isPrimary: true,
    workspaceSlug: workspace.slug,
    workspaceName: workspace.name,
    ...overrides,
  }
}

const originalRoot = process.env.SAAS_CORE_ROOT_DOMAIN

beforeEach(() => {
  process.env.SAAS_CORE_ROOT_DOMAIN = "example.com"
  resolveHost.mockReset()
})

afterEach(() => {
  if (originalRoot === undefined) delete process.env.SAAS_CORE_ROOT_DOMAIN
  else process.env.SAAS_CORE_ROOT_DOMAIN = originalRoot
})

describe("public Workspace resolution", () => {
  it("resolves an active platform domain and passes only the normalized path", async () => {
    resolveHost.mockResolvedValue(resolution("acme.example.com"))

    const result = await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example?workspace=other" })
    expect(result).toEqual({
      status: "resolved",
      context: {
        workspaceId: workspace.id,
        workspaceSlug: "acme",
        workspaceName: "Acme",
        siteId: "22222222-2222-4222-8222-222222222222",
        productKey: "saas-core",
        domainId: "33333333-3333-4333-8333-333333333333",
        hostname: "acme.example.com",
        normalizedHostname: "acme.example.com",
        domainType: "platform_subdomain",
        isPrimary: true,
        hostnameKind: "HOSTED_WORKSPACE",
        pathname: "/example",
      },
    })
  })

  it("resolves a development nip.io domain with the same hosted semantics", async () => {
    const hostname = "acme.192.168.1.108.nip.io"
    resolveHost.mockResolvedValue(resolution(hostname))

    const result = await resolvePublicWorkspace({ hostname: hostname + ":3100", pathname: "/beach?workspace=other" })
    expect(result).toMatchObject({
      status: "resolved",
      context: {
        workspaceId: workspace.id,
        hostname,
        hostnameKind: "HOSTED_WORKSPACE",
        pathname: "/beach",
      },
    })
  })

  it("fails closed for unknown or inactive domains", async () => {
    resolveHost.mockResolvedValue(null)
    expect(await resolvePublicWorkspace({ hostname: "unknown.example.com", pathname: "/beach" })).toEqual({ status: "not_found" })
    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "not_found" })
  })

  it("distinguishes resolver failures from not-found results", async () => {
    resolveHost.mockRejectedValue(new Error("database unavailable"))
    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "unavailable" })

    resolveHost.mockRejectedValue(new Error("service role unavailable"))
    expect(await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })).toEqual({ status: "unavailable" })
  })

  it("requires an active canonical custom-domain resolution", async () => {
    resolveHost.mockResolvedValue(resolution("custom.customer.com", { domainType: "custom", isPrimary: false }))
    const resolved = await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })
    expect(resolved).toMatchObject({
      status: "resolved",
      context: { workspaceId: workspace.id, workspaceSlug: "acme", pathname: "/example", hostnameKind: "CUSTOM_WORKSPACE", domainType: "custom", isPrimary: false },
    })

    resolveHost.mockResolvedValue(null)
    expect(await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })).toEqual({ status: "not_found" })
  })

  it("returns the same logical site context for hosted and custom hostnames", async () => {
    resolveHost.mockResolvedValue(resolution("acme.example.com"))
    const hosted = await resolvePublicWorkspace({ hostname: "acme.example.com", pathname: "/example" })
    resolveHost.mockResolvedValue(resolution("custom.customer.com", { domainType: "custom", isPrimary: false }))
    const custom = await resolvePublicWorkspace({ hostname: "custom.customer.com", pathname: "/example" })

    expect(hosted.status).toBe("resolved")
    expect(custom.status).toBe("resolved")
    if (hosted.status === "resolved" && custom.status === "resolved") {
      expect(custom.context.workspaceId).toBe(hosted.context.workspaceId)
      expect(custom.context.siteId).toBe(hosted.context.siteId)
      expect(custom.context.productKey).toBe(hosted.context.productKey)
      expect(custom.context.pathname).toBe(hosted.context.pathname)
    }
  })

  it("does not resolve platform, local, reserved, or canonical app surfaces", async () => {
    for (const input of [
      { hostname: "example.com", pathname: "/beach" },
      { hostname: "app.example.com", pathname: "/beach" },
      { hostname: "acme.localhost:3000", pathname: "/example" },
      { hostname: "something.nip.io", pathname: "/example" },
      { hostname: "acme.example.com", pathname: "/app" },
      { hostname: "acme.example.com", pathname: "/api/health" },
    ]) {
      expect(await resolvePublicWorkspace(input)).toEqual({ status: "not_public_workspace" })
    }
    expect(resolveHost).not.toHaveBeenCalled()
  })

  it("uses the shared trusted request hostname and ignores tenant query overrides", async () => {
    resolveHost.mockResolvedValue(resolution("acme.example.com"))
    const request = new Request("https://0.0.0.0:3000/beach?workspaceId=another", {
      headers: { host: "acme.example.com" },
    })
    const result = await resolvePublicWorkspaceRequest(request)
    expect(result).toMatchObject({ status: "resolved", context: { workspaceId: workspace.id, pathname: "/beach" } })
    expect(resolveHost).toHaveBeenCalledWith("acme.example.com")
  })

  it("fails closed when the trusted request resolver cannot operate", async () => {
    resolveHost.mockRejectedValue(new Error("private database detail"))
    const request = new Request("https://0.0.0.0:3000/beach", {
      headers: { host: "acme.example.com" },
    })

    await expect(resolvePublicWorkspaceRequest(request)).resolves.toEqual({ status: "unavailable" })
  })
})
