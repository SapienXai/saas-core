import { describe, expect, it } from "vitest"
import { CORE_SCHEMA_VERSION, CORE_VERSION, evaluateCompatibility, modulesForConfig, parseCliFlags, resolveCliConfig } from "./cli-config.js"
import { inspectProviderConfiguration } from "./provider-config.js"

describe("CLI v1.1 configuration", () => {
  it("uses safe non-interactive defaults and records selected modules", () => {
    const config = resolveCliConfig({ flags: parseCliFlags(["--yes", "--non-interactive"]), interactive: false })
    expect(config.version).toBe(CORE_VERSION)
    expect(config.installDependencies).toBe(false)
    expect(modulesForConfig(config)).toEqual(expect.arrayContaining(["billing", "notifications", "platform", "core-lab"]))
  })

  it("supports explicit module removal without leaving provider packages enabled", () => {
    const config = resolveCliConfig({ flags: parseCliFlags(["--without-billing", "--without-platform", "--with-pwa", "--with-push"]) })
    expect(config.billing).toBe(false)
    expect(config.platform).toBe(false)
    expect(config.pwa).toBe(true)
    expect(config.push).toBe(true)
    expect(modulesForConfig(config)).not.toEqual(expect.arrayContaining(["billing", "platform"]))
  })

  it("detects package, schema and manifest incompatibility", () => {
    expect(evaluateCompatibility({ packageVersions: { core: "1.1.0", runtime: "1.0.0" } }).status).toBe("incompatible")
    expect(evaluateCompatibility({ packageVersions: { core: "1.1.0" }, schemaVersion: "1.2-p0" }).status).toBe("warning")
    expect(evaluateCompatibility({ packageVersions: { core: CORE_VERSION }, schemaVersion: CORE_SCHEMA_VERSION, manifestVersion: CORE_VERSION }).status).toBe("compatible")
  })

  it("reports disabled providers distinctly and never treats credentials as live health", () => {
    const checks = inspectProviderConfiguration({ PADDLE_API_KEY: "secret", PADDLE_WEBHOOK_SECRET: "secret" }, { billing: true, email: false, domains: false, pwa: false, push: false, platform: true })
    expect(checks.find((check) => check.key === "billing")?.state).toBe("configured_unverified")
    expect(checks.find((check) => check.key === "email")?.state).toBe("disabled")
  })
})
