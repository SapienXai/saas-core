import { describe, expect, it } from "vitest"
import { resolveSidebarUsageItems } from "../lib/management-sidebar-usage"

const coreLabels = {
  "core.workspaces": "Workspaces",
  "core.members": "Team",
}

describe("management sidebar usage model", () => {
  it("keeps the existing Core metrics when no presentation metrics are configured", () => {
    expect(resolveSidebarUsageItems({
      usage: { workspaces: 2, users: 4, metrics: {} },
      limits: { "core.workspaces": 3, "core.members": 6 },
      productConfig: { catalog: { usageMetrics: [] } },
      coreLabels,
    })).toEqual([
      { key: "core.workspaces", label: "Workspaces", used: 2, limit: 3 },
      { key: "core.members", label: "Team", used: 4, limit: 6 },
    ])
  })

  it("uses product-configured limit keys and presentation labels", () => {
    expect(resolveSidebarUsageItems({
      usage: { workspaces: 9, users: 4, metrics: { venues: 2 } },
      limits: { "core.members": 6, venues: 3 },
      productConfig: {
        billingPresentation: {
          limitKeys: ["core.members", "venues"],
          comparison: [{ key: "venue-limit", label: "Places", kind: "limit", limitKey: "venues" }],
        },
        catalog: { usageMetrics: [{ key: "venues", name: "Venues" }] },
      },
      coreLabels,
    })).toEqual([
      { key: "core.members", label: "Team", used: 4, limit: 6 },
      { key: "venues", label: "Places", used: 2, limit: 3 },
    ])
  })

  it("supports arbitrary product metrics through usage definitions without Core-specific keys", () => {
    expect(resolveSidebarUsageItems({
      usage: { metrics: { projects: 7 } },
      limits: { projects: 10 },
      productConfig: { catalog: { usageMetrics: [{ key: "projects", name: "Projects" }], presentation: { limitKeys: ["projects"] } } },
      coreLabels,
    })).toEqual([{ key: "projects", label: "Projects", used: 7, limit: 10 }])
  })

  it("preserves explicit unlimited and unknown states", () => {
    expect(resolveSidebarUsageItems({
      usage: { metrics: {} },
      limits: { projects: null, missing: undefined },
      productConfig: { billingPresentation: { limitKeys: ["projects", "missing"] } },
    })).toEqual([
      { key: "projects", label: "Projects", used: undefined, limit: null },
      { key: "missing", label: "Missing", used: undefined, limit: undefined },
    ])
  })

  it("bounds compact sidebar metrics to the first two configured keys", () => {
    expect(resolveSidebarUsageItems({
      usage: { metrics: { one: 1, two: 2, three: 3 } },
      limits: { one: 1, two: 2, three: 3 },
      productConfig: { billingPresentation: { limitKeys: ["one", "two", "three"] } },
      maxItems: 2,
    }).map((item) => item.key)).toEqual(["one", "two"])
  })
})
