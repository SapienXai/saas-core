import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type TestUsageResolver = (context: {
  workspaceId: string
  userId?: string
  periodStart: string
  periodEnd: string
  now: Date
  db: unknown
}) => number | Promise<number>

const { createServiceRoleClient, productResolvers } = vi.hoisted(() => ({
  createServiceRoleClient: vi.fn(),
  productResolvers: {} as Record<string, TestUsageResolver>,
}))

vi.mock("@/lib/supabase", () => ({ createServiceRoleClient }))
vi.mock("@/src/product/usage", () => ({ getProductUsageResolvers: () => productResolvers }))

import { getUsage, getWorkspaceUsage } from "../lib/entitlements"

type QueryResult = { data: unknown; count?: number; error: null | { message: string; code?: string } }
type QueryBuilder = {
  select: (...args: unknown[]) => QueryBuilder
  eq: (...args: unknown[]) => QueryBuilder
  is: (...args: unknown[]) => QueryBuilder
  gt: (...args: unknown[]) => QueryBuilder
  maybeSingle: () => Promise<QueryResult>
  then: Promise<QueryResult>["then"]
}

function createService() {
  const service = {
    from: vi.fn((table: string) => {
      const filters = new Map<string, unknown>()
      const result = (): QueryResult => table === "workspaces"
        ? { data: { id: "resolver-workspace", created_by: "resolver-owner", status: "active", platform_status: "active" }, error: null }
        : table === "workspace_members"
          ? { data: null, count: filters.has("user_id") ? 1 : 2, error: null }
          : table === "workspace_invitations"
            ? { data: null, count: 1, error: null }
            : table === "workspace_usage_periods"
              ? { data: { usage: {} }, error: null }
              : { data: null, error: null }
      const builder = {} as QueryBuilder
      builder.select = (...args: unknown[]) => {
        if (args[1] && typeof args[1] === "object" && "count" in args[1]) filters.set("count", args[1])
        return builder
      }
      builder.eq = (key: unknown, value: unknown) => {
        if (typeof key === "string") filters.set(key, value)
        return builder
      }
      builder.is = () => builder
      builder.gt = () => builder
      builder.maybeSingle = async () => {
        if (table === "workspace_members" && filters.has("user_id")) return { data: { id: "membership" }, error: null }
        return result()
      }
      builder.then = ((onfulfilled, onrejected) => Promise.resolve(result()).then(onfulfilled, onrejected)) as QueryBuilder["then"]
      return builder
    }),
  }
  return service
}

describe("consumer-owned usage resolver composition", () => {
  beforeEach(() => {
    for (const key of Object.keys(productResolvers)) delete productResolvers[key]
    createServiceRoleClient.mockReturnValue(createService())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps Core metrics authoritative and passes server context to a product resolver", async () => {
    const observed: { workspaceId?: string; userId?: string; db?: unknown } = {}
    productResolvers.locations = async (context) => {
      observed.workspaceId = context.workspaceId
      observed.userId = context.userId
      observed.db = context.db
      return 4
    }
    productResolvers["core.members"] = () => 999

    await expect(getUsage("resolver-workspace", "locations", "resolver-user")).resolves.toBe(4)
    await expect(getUsage("resolver-workspace", "core.members")).resolves.toBe(3)
    expect(observed.workspaceId).toBe("resolver-workspace")
    expect(observed.userId).toBe("resolver-user")
    expect(observed.db).toBeTruthy()
  })

  it("feeds valid product usage to the shared Plan data model and omits failed counters", async () => {
    productResolvers.locations = () => 4
    productResolvers.broken = () => { throw new Error("database details must not reach the Plan surface") }
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const usage = await getWorkspaceUsage("resolver-workspace")

    expect(usage.metrics).toMatchObject({ "core.workspaces": 1, "core.members": 3, locations: 4 })
    expect(usage.metrics).not.toHaveProperty("broken")
    expect(error).toHaveBeenCalledWith("Unable to resolve product usage for Plan presentation:", { metric: "broken", code: "USAGE_UNAVAILABLE" })
  })

  it("returns explicit unavailable errors instead of turning unknown or malformed usage into zero", async () => {
    await expect(getUsage("unknown-resolver-workspace", "locations")).rejects.toMatchObject({ code: "USAGE_UNAVAILABLE" })

    for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, "4"] as unknown[]) {
      productResolvers.locations = () => value as number
      await expect(getUsage(`invalid-${String(value)}`, "locations")).rejects.toMatchObject({ code: "USAGE_UNAVAILABLE" })
    }
  })
})
