import { describe, expect, it } from "vitest"
import {
  getActiveProductNavigationKey,
  isCoreReservedAppPath,
  isProductNavigationVisible,
  matchesProductNavigation,
  resolveProductShellConfig,
} from "../lib/product-shell"

describe("product shell extension contract", () => {
  it("keeps old consumers on the Core dashboard when shell is absent", () => {
    expect(resolveProductShellConfig({}).homePath).toBe("/app")
    expect(resolveProductShellConfig({}).homeLabel).toBe(null)
    expect(resolveProductShellConfig({}).navigation).toEqual([])
  })

  it("rejects unsafe and Core-reserved home paths", () => {
    expect(resolveProductShellConfig({ shell: { homePath: "https://example.test" } }).homePath).toBe("/app")
    expect(resolveProductShellConfig({ shell: { homePath: "/app/team" } }).homePath).toBe("/app")
    expect(resolveProductShellConfig({ shell: { homePath: "/app/product-home/" } }).homePath).toBe("/app/product-home")
    expect(isCoreReservedAppPath("/app/team/members")).toBe(true)
    expect(isCoreReservedAppPath("/app/product-home")).toBe(false)
  })

  it("normalizes navigation, falls back unknown icons, and removes duplicates", () => {
    const shell = resolveProductShellConfig({
      shell: {
        homePath: "/app/product-home",
        navigation: [
          { key: "projects", label: "Projects", href: "/app/projects", icon: "folder", match: "prefix" },
          { key: "projects", label: "Duplicate", href: "/app/duplicate" },
          { key: "duplicate-href", label: "Duplicate href", href: "/app/projects" },
          { key: "team", label: "Reserved", href: "/app/team" },
          { key: "invalid", label: "Invalid roles", href: "/app/invalid", workspaceRoles: ["operator"] },
          { key: "reports", label: "Reports", href: "/app/reports", icon: "not-a-real-icon", requiredFeature: "exports" },
        ],
      },
    })

    expect(shell.navigation).toEqual([
      { key: "projects", label: "Projects", href: "/app/projects", icon: "folder", match: "prefix" },
      { key: "reports", label: "Reports", href: "/app/reports", icon: "layers", match: "exact", requiredFeature: "exports" },
    ])
  })

  it("supports exact and prefix active states with longest-match precedence", () => {
    const navigation = resolveProductShellConfig({ shell: { navigation: [
      { key: "projects", label: "Projects", href: "/app/projects", match: "prefix" },
      { key: "project-settings", label: "Project settings", href: "/app/projects/settings", match: "exact" },
    ] } }).navigation
    expect(matchesProductNavigation("/app/projects/one", navigation[0])).toBe(true)
    expect(matchesProductNavigation("/app/projects/settings/advanced", navigation[1])).toBe(false)
    expect(getActiveProductNavigationKey("/app/projects/settings", navigation)).toBe("project-settings")
    expect(getActiveProductNavigationKey("/app/team", navigation)).toBe(null)
  })

  it("filters navigation by workspace role and feature entitlement", () => {
    const shell = resolveProductShellConfig({ shell: { navigation: [
      { key: "team-space", label: "Team space", href: "/app/team-space", workspaceRoles: ["owner", "admin"] },
      { key: "exports", label: "Exports", href: "/app/exports", requiredFeature: "exports" },
    ] } })
    expect(isProductNavigationVisible(shell.navigation[0], "owner", {})).toBe(true)
    expect(isProductNavigationVisible(shell.navigation[0], "staff", {})).toBe(false)
    expect(isProductNavigationVisible(shell.navigation[1], "staff", { exports: true })).toBe(true)
    expect(isProductNavigationVisible(shell.navigation[1], "staff", { exports: false })).toBe(false)
  })
})
