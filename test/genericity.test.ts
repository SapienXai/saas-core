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
          { key: "hobby", name: "Hobby", prices: { month: { amount: 7, currency: "EUR" } }, features: { projects: true }, limits: { projects: 25 } },
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
    expect(evaluateCompatibility({ manifestVersion: CORE_VERSION, schemaVersion: CORE_SCHEMA_VERSION }).status).toBe("compatible")
    expect(evaluateCompatibility({ manifestVersion: "3.0.0", schemaVersion: CORE_SCHEMA_VERSION }).status).toBe("incompatible")
    expect(evaluateCompatibility({ manifestVersion: CORE_VERSION, schemaVersion: "1.3.1" }).status).toBe("incompatible")
    expect(evaluateCompatibility({ packageVersions: { "@sapienx/saas-core": "file:../checkout" } }).status).toBe("incompatible")
  })
})
