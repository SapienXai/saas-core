import { afterEach, describe, expect, it } from "vitest"
import { getCustomDomainTarget, isCustomDomainSetupConfigured } from "../lib/domains/domain-config"

const originalTarget = process.env.RESERVEVIA_CUSTOM_DOMAIN_TARGET

afterEach(() => {
  if (originalTarget === undefined) delete process.env.RESERVEVIA_CUSTOM_DOMAIN_TARGET
  else process.env.RESERVEVIA_CUSTOM_DOMAIN_TARGET = originalTarget
})

describe("custom domain DNS configuration", () => {
  it("fails closed when the customer-facing target is missing", () => {
    delete process.env.RESERVEVIA_CUSTOM_DOMAIN_TARGET
    expect(getCustomDomainTarget()).toBeNull()
    expect(isCustomDomainSetupConfigured()).toBe(false)
  })

  it("returns the configured target only after validating it", () => {
    process.env.RESERVEVIA_CUSTOM_DOMAIN_TARGET = "cname.reservevia.com"
    expect(getCustomDomainTarget()).toBe("cname.reservevia.com")
    expect(isCustomDomainSetupConfigured()).toBe(true)

    process.env.RESERVEVIA_CUSTOM_DOMAIN_TARGET = "https://cname.reservevia.com/path"
    expect(getCustomDomainTarget()).toBeNull()
    expect(isCustomDomainSetupConfigured()).toBe(false)
  })
})
