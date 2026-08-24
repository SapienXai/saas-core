import { describe, expect, it } from "vitest"
import { defaultSaaSCoreConfig, validateSaaSCoreConfig } from "./index.js"

describe("typed core config", () => {
  it("provides a valid provider-safe default", () => {
    const config = defaultSaaSCoreConfig({ key: "projects", name: "Projects" })
    expect(config.version).toBe("1.1.1")
    expect(config.billing.provider).toBe("paddle")
    expect(config.platform.supportReadOnly).toBe(true)
  })

  it("reports configuration paths without exposing secret values", () => {
    const result = validateSaaSCoreConfig({ version: "1.1.1", product: { key: "bad value", name: "X" } })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.errors.some((error) => error.includes("product.key"))).toBe(true)
  })
})
