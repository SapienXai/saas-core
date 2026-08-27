import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  addProjectDomain: vi.fn(),
  getProjectDomain: vi.fn(),
  verifyProjectDomain: vi.fn(),
  removeProjectDomain: vi.fn(),
  getDomainConfig: vi.fn(),
}))

vi.mock("@vercel/sdk", () => ({
  Vercel: class MockVercel {
    projects = mocks
    domains = { getDomainConfig: mocks.getDomainConfig }
  },
}))

import {
  addProjectDomain,
  getProjectDomain,
  removeProjectDomain,
  verifyProjectDomain,
  VercelProviderError,
  isVercelProviderConfigured,
} from "../lib/domains/vercel"

const originalEnvironment = {
  token: process.env.VERCEL_API_TOKEN,
  project: process.env.VERCEL_PROJECT_ID,
  team: process.env.VERCEL_TEAM_ID,
}

afterEach(() => {
  process.env.VERCEL_API_TOKEN = originalEnvironment.token
  process.env.VERCEL_PROJECT_ID = originalEnvironment.project
  process.env.VERCEL_TEAM_ID = originalEnvironment.team
  Object.values(mocks).forEach((mock) => mock.mockReset())
})

function configureProvider() {
  process.env.VERCEL_API_TOKEN = "test-vercel-token"
  process.env.VERCEL_PROJECT_ID = "prj_saas_core_test"
  process.env.VERCEL_TEAM_ID = "team_saas_core_test"
}

describe("Vercel domain provider boundary", () => {
  it("fails closed when server configuration is missing", async () => {
    delete process.env.VERCEL_API_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    await expect(addProjectDomain("workspace.example.test")).rejects.toMatchObject({ code: "NOT_CONFIGURED" })
  })

  it("treats placeholder environment values as missing configuration", async () => {
    process.env.VERCEL_API_TOKEN = "vercel_api_token_placeholder"
    process.env.VERCEL_PROJECT_ID = "prj_saas_core_project_id_placeholder"
    process.env.VERCEL_TEAM_ID = "team_saas_core_team_id_placeholder"

    expect(isVercelProviderConfigured()).toBe(false)
    await expect(addProjectDomain("workspace.example.test")).rejects.toMatchObject({ code: "NOT_CONFIGURED" })
  })

  it("returns provider verification and DNS requirements without force reassignment", async () => {
    configureProvider()
    mocks.addProjectDomain.mockResolvedValue({
      name: "workspace.example.test",
      projectId: "prj_saas_core_test",
      verified: false,
      verification: [{ type: "TXT", domain: "_vercel.workspace.example.test", value: "verify-value", reason: "ownership" }],
    })
    mocks.getDomainConfig.mockResolvedValue({
      configuredBy: null,
      misconfigured: true,
      acceptedChallenges: ["dns-01"],
      recommendedIPv4: [],
      recommendedCNAME: [{ rank: 1, value: "cname.vercel-dns.example" }],
    })

    const result = await addProjectDomain("workspace.example.test")
    expect(result.domain.verified).toBe(false)
    expect(result.domain.verification?.[0]).toMatchObject({ type: "TXT", value: "verify-value" })
    expect(result.dns).toMatchObject({ misconfigured: true, recommendedCNAME: [{ value: "cname.vercel-dns.example" }] })
    expect(mocks.addProjectDomain).toHaveBeenCalledWith(expect.objectContaining({ idOrName: "prj_saas_core_test", teamId: "team_saas_core_test", requestBody: { name: "workspace.example.test" } }))
  })

  it("maps verified/configured state and supports refresh/verify/remove", async () => {
    configureProvider()
    const domain = { name: "workspace.example.test", projectId: "prj_saas_core_test", verified: true }
    const dns = { configuredBy: "CNAME", misconfigured: false, recommendedIPv4: [], recommendedCNAME: [] }
    mocks.getProjectDomain.mockResolvedValue(domain)
    mocks.verifyProjectDomain.mockResolvedValue(domain)
    mocks.getDomainConfig.mockResolvedValue(dns)
    mocks.removeProjectDomain.mockResolvedValue({})

    expect((await getProjectDomain("workspace.example.test")).domain.verified).toBe(true)
    expect((await verifyProjectDomain("workspace.example.test")).dns?.configuredBy).toBe("CNAME")
    await removeProjectDomain("workspace.example.test")
    expect(mocks.removeProjectDomain).toHaveBeenCalledWith(expect.objectContaining({ domain: "workspace.example.test", requestBody: { removeRedirects: false } }))
  })

  it("turns provider ownership conflicts into a safe typed error", async () => {
    configureProvider()
    mocks.addProjectDomain.mockRejectedValue(new Error("domain already exists on another project"))
    await expect(addProjectDomain("workspace.example.test")).rejects.toBeInstanceOf(VercelProviderError)
    await expect(addProjectDomain("workspace.example.test")).rejects.toMatchObject({ code: "DOMAIN_CONFLICT" })
  })

  it("preserves provider ownership and release states", async () => {
    configureProvider()
    const owned = Object.assign(new Error("API error occurred"), {
      statusCode: 400,
      body: JSON.stringify({ code: "domain_already_owned", message: "Domain is owned by another team" }),
    })
    mocks.addProjectDomain.mockRejectedValueOnce(owned)
    await expect(addProjectDomain("workspace.example.test")).rejects.toMatchObject({ code: "DOMAIN_CONFLICT" })

    const releasing = Object.assign(new Error("Domain is still being released"), {
      statusCode: 400,
      body: JSON.stringify({ code: "domain_already_owned", message: "Domain is still being released" }),
    })
    mocks.addProjectDomain.mockRejectedValueOnce(releasing)
    await expect(addProjectDomain("workspace.example.test")).rejects.toMatchObject({ code: "DOMAIN_RELEASING" })
  })

  it("maps a missing project domain to a typed not-found error", async () => {
    configureProvider()
    mocks.getProjectDomain.mockRejectedValue(Object.assign(new Error("not found"), { statusCode: 404, body: "" }))
    await expect(getProjectDomain("workspace.example.test")).rejects.toMatchObject({ code: "DOMAIN_NOT_FOUND" })
  })

  it("maps invalid Vercel credentials to a configuration error", async () => {
    configureProvider()
    mocks.addProjectDomain.mockRejectedValueOnce(Object.assign(new Error("Not authorized"), {
      statusCode: 403,
      body: JSON.stringify({ code: "forbidden", message: "Not authorized", invalidToken: true }),
    }))
    await expect(addProjectDomain("workspace.example.test")).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      message: "Vercel credentials are invalid or do not have access to the configured project/team.",
    })
  })
})
