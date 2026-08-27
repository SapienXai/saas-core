import { describe, expect, it } from "vitest"
import { canAccessRestaurant, roleAllows } from "../lib/authorization"
import { canManageWorkspaceUsers, canWrite, scopeContainsRestaurant, type RestaurantScope, type UserAccess } from "../lib/auth-utils"
import { canManageBilling, canReadPlatform, canWritePlatform } from "../lib/platform-authorization"
import { platformRoleAllows } from "../lib/platform-types"

describe("workspace and restaurant authorization decisions", () => {
  it("allows a member to access a restaurant in the member workspace", () => {
    expect(canAccessRestaurant({
      membershipRole: "manager",
      profileRestaurantId: "restaurant-a",
      restaurantId: "restaurant-a",
    })).toBe(true)
  })

  it("rejects a user with no membership in the restaurant workspace", () => {
    expect(canAccessRestaurant({
      membershipRole: null,
      profileRestaurantId: "restaurant-a",
      restaurantId: "restaurant-b",
    })).toBe(false)
  })

  it("rejects a staff member attempting a forged restaurant ID", () => {
    expect(canAccessRestaurant({
      membershipRole: "staff",
      profileRestaurantId: "restaurant-a",
      restaurantId: "restaurant-b",
    })).toBe(false)
  })

  it("keeps workspace authority separate from legacy readonly compatibility", () => {
    expect(roleAllows("owner", ["owner", "admin"])).toBe(true)
    expect(roleAllows("manager", ["owner", "admin"])).toBe(false)
    expect(roleAllows("readonly", ["readonly"])).toBe(true)
  })

  it("uses workspace membership roles for write and user-management decisions", () => {
    const readonlyAccess: UserAccess = {
      userId: "user-a",
      restaurantId: "restaurant-a",
      role: "staff",
      workspaceRole: "readonly",
      workspaceAvailable: true,
      platformRole: null,
      isSuperAdmin: false,
    }
    const ownerAccess: UserAccess = { ...readonlyAccess, workspaceRole: "owner" }

    expect(canWrite(readonlyAccess)).toBe(false)
    expect(canWrite(ownerAccess)).toBe(true)
    expect(canManageWorkspaceUsers(readonlyAccess)).toBe(false)
    expect(canManageWorkspaceUsers(ownerAccess)).toBe(true)
  })

  it("scopes reservation and restaurant queries to explicit authorized IDs", () => {
    const scope: RestaurantScope = { type: "many", ids: ["restaurant-a", "restaurant-b"] }
    expect(scopeContainsRestaurant(scope, "restaurant-a")).toBe(true)
    expect(scopeContainsRestaurant(scope, "restaurant-c")).toBe(false)
    expect(scopeContainsRestaurant({ type: "deny" }, "restaurant-a")).toBe(false)
  })

  it("does not infer platform access from workspace ownership", () => {
    expect(canReadPlatform(null)).toBe(false)
    expect(platformRoleAllows("platform_owner", ["platform_owner"])).toBe(true)
    expect(platformRoleAllows("platform_admin", ["platform_owner"])).toBe(false)
  })

  it("keeps platform write and billing scopes separate", () => {
    expect(canWritePlatform("platform_admin")).toBe(true)
    expect(canManageBilling("platform_admin")).toBe(false)
    expect(canManageBilling("billing_admin")).toBe(true)
    expect(canWritePlatform("support")).toBe(false)
    expect(canReadPlatform("auditor")).toBe(true)
  })
})
