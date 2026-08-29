import { describe, expect, it } from "vitest"
import { CORE_SCHEMA_VERSION, CORE_VERSION, defineProductConfig as defineCoreProductConfig, evaluateCompatibility } from "../packages/core/src/index"
import { defineProductConfig, validateProductCatalog } from "../packages/config/src/index"

describe("generic Core contracts", () => {
  it("accepts arbitrary product plans, feature keys, prices, and usage metrics", () => {
    const config = defineProductConfig({
      identity: { name: "Projects Proof", slug: "projects-proof" },
      capabilities: { billing: true },
      catalog: {
        defaultPlanKey: "hobby",
        plans: [
          { key: "hobby", name: "Hobby", prices: { month: { amount: 7, currency: "EUR" } }, features: { projects: true }, limits: { "core.workspaces": 2, projects: 25 } },
          { key: "scale", name: "Scale", prices: { year: { amount: 1200, currency: "JPY" } }, features: { projects: true, exports: true }, limits: { projects: null } },
        ],
        usageMetrics: [{ key: "projects", name: "Projects" }, { key: "generations", name: "Generations", unit: "runs" }],
      },
    })
    expect(config.catalog.plans.map((plan) => plan.key)).toEqual(["hobby", "scale"])
    expect(validateProductCatalog(config.catalog).usageMetrics?.map((metric) => metric.key)).toEqual(["projects", "generations"])
    expect(defineCoreProductConfig(config).identity.slug).toBe("projects-proof")
  })

  it("separates runtime and schema compatibility", () => {
    expect(CORE_VERSION).toBe("2.1.0")
    expect(CORE_SCHEMA_VERSION).toBe("2.0")
    expect(evaluateCompatibility({ manifestVersion: "2.0.0", schemaVersion: "2.0" }).status).toBe("compatible")
    expect(evaluateCompatibility({ manifestVersion: CORE_VERSION, schemaVersion: CORE_SCHEMA_VERSION }).status).toBe("compatible")
    expect(evaluateCompatibility({ manifestVersion: "3.0.0", schemaVersion: CORE_SCHEMA_VERSION }).status).toBe("incompatible")
    expect(evaluateCompatibility({ manifestVersion: CORE_VERSION, schemaVersion: "1.3.1" }).status).toBe("incompatible")
    expect(evaluateCompatibility({ packageVersions: { "@sapienx/saas-core": "file:../checkout" } }).status).toBe("incompatible")
  })

  it("keeps the post-Core onboarding handoff product-owned and internal", () => {
    const config = defineProductConfig({
      identity: { name: "Projects Proof", slug: "projects-proof" },
      capabilities: {},
      onboarding: { productSetupPath: "/projects/setup" },
      catalog: { defaultPlanKey: "default", plans: [{ key: "default", name: "Default", limits: { "core.workspaces": null } }], usageMetrics: [] },
    })
    expect(config.onboarding?.productSetupPath).toBe("/projects/setup")
    expect(() => defineCoreProductConfig({ ...config, onboarding: { productSetupPath: "https://example.test" } })).toThrow("internal path")
  })

  it("keeps manual Workspace provisioning as the default and makes deferred setup explicit", () => {
    const base = {
      identity: { name: "Manual Proof", slug: "manual-proof" },
      capabilities: {},
      catalog: { defaultPlanKey: "default", plans: [{ key: "default", name: "Default", limits: { "core.workspaces": 1 } }], usageMetrics: [] },
    }
    expect(defineProductConfig(base).onboarding).toBeUndefined()
    expect(defineCoreProductConfig({ ...base, onboarding: { productSetupPath: "/projects/setup", workspaceProvisioning: "deferred" } }).onboarding?.workspaceProvisioning).toBe("deferred")
    expect(() => defineCoreProductConfig({ ...base, onboarding: { workspaceProvisioning: "deferred" } })).toThrow("requires a product onboarding path")
  })
})
