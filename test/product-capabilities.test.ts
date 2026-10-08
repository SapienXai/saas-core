import { describe, expect, it } from "vitest"
import { isProductCapabilityEnabled } from "../lib/product-config"

describe("product capability platform-role policies", () => {
  it("preserves existing capability behavior when no role policy is configured", () => {
    const config = { capabilities: { workspaceTeamManagement: true } }

    expect(isProductCapabilityEnabled("workspaceTeamManagement", null, config)).toBe(true)
    expect(isProductCapabilityEnabled("workspaceTeamManagement", "platform_owner", config)).toBe(true)
  })

  it("requires an explicitly allowed platform role when a role policy is configured", () => {
    const config = {
      capabilities: { workspaceTeamManagement: true },
      capabilityPlatformRoles: { workspaceTeamManagement: ["platform_owner"] },
    }

    expect(isProductCapabilityEnabled("workspaceTeamManagement", "platform_owner", config)).toBe(true)
    expect(isProductCapabilityEnabled("workspaceTeamManagement", "platform_admin", config)).toBe(false)
    expect(isProductCapabilityEnabled("workspaceTeamManagement", null, config)).toBe(false)
  })

  it("keeps an explicitly disabled capability off for every role", () => {
    const config = {
      capabilities: { workspaceTeamManagement: false },
      capabilityPlatformRoles: { workspaceTeamManagement: ["platform_owner"] },
    }

    expect(isProductCapabilityEnabled("workspaceTeamManagement", "platform_owner", config)).toBe(false)
  })

  it("treats an empty allowlist as deny all", () => {
    const config = {
      capabilities: { workspaceTeamManagement: true },
      capabilityPlatformRoles: { workspaceTeamManagement: [] },
    }

    expect(isProductCapabilityEnabled("workspaceTeamManagement", "platform_owner", config)).toBe(false)
  })
})
