import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("platform control hardening", () => {
  it("keeps API search authorization and safe errors server-side", () => {
    const route = readFileSync("app/api/platform/search/route.ts", "utf8")
    expect(route).toContain("AuthorizationError")
    expect(route).toContain("Authentication required.")
    expect(readFileSync("lib/platform-admin.ts", "utf8")).toContain('import "server-only"')
  })

  it("keeps support inspection read-only and audited", () => {
    const support = readFileSync("lib/platform-support.ts", "utf8")
    expect(support).toContain("requirePlatformRole")
    expect(support).toContain('platform.support.view')
    expect(support).not.toContain("auth.admin")
  })

  it("keeps domain refresh scoped to provider reads and audit state", () => {
    const operations = readFileSync("lib/platform-operations.ts", "utf8")
    expect(operations).toContain("requirePlatformWriteAccess")
    expect(operations).toContain("platform.domain.recheck")
    expect(operations).toContain("getProjectDomain")
    expect(operations).not.toContain("removeProjectDomain")
  })
})
