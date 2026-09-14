import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("platform control hardening", () => {
  it("keeps API search authorization and safe errors server-side", () => {
    const route = readFileSync("app/api/platform/search/route.ts", "utf8")
    expect(route).toContain("AuthorizationError")
    expect(route).toContain("Authentication required.")
    expect(readFileSync("lib/platform-admin.ts", "utf8")).toContain('import "server-only"')
  })

  it("keeps platform-user administration server-side, authorized and audited", () => {
    const platform = readFileSync("lib/platform-admin.ts", "utf8")
    expect(platform).toContain("requirePlatformRole")
    expect(platform).toContain("requirePlatformWriteAccess")
    expect(platform).toContain("platform_audit_logs")
    expect(platform).toContain("auth.admin.listUsers")
    expect(platform).toContain("auth.admin.createUser")
    expect(platform).toContain("auth.admin.deleteUser")
    expect(platform).toContain("platform_user_controls")
  })

  it("keeps plan catalog mutations platform-billing-only and historical-safe", () => {
    const platform = readFileSync("lib/platform-admin.ts", "utf8")
    const actions = readFileSync("app/platform/billing/actions.ts", "utf8")
    const component = readFileSync("components/platform/platform-plan-management.tsx", "utf8")
    expect(platform).toContain("requirePlatformBillingAccess")
    expect(platform).toContain("createPlatformPlan")
    expect(platform).toContain("updatePlatformPlan")
    expect(platform).toContain("archivePlatformPlan")
    expect(platform).toContain("duplicatePlatformPlan")
    expect(platform).toContain("hasCommercialPlanChange")
    expect(platform).toContain('action: "plan.created"')
    expect(platform).toContain('"plan.archived"')
    expect(actions).toContain('"use server"')
    expect(actions).toContain("createPlatformPlanAction")
    expect(component).toContain("provider price mappings")
    expect(component).toContain("Entitlement maps are validated on the server")
    expect(component).toContain('data.set("newKey", form.key)')
  })

  it("keeps domain refresh scoped to provider reads and audit state", () => {
    const operations = readFileSync("lib/domains/domain-service.ts", "utf8")
    expect(operations).toContain("requireWorkspaceRole")
    expect(operations).toContain("getProjectDomain")
    expect(operations).toContain('eq("workspace_id", workspaceId)')
    expect(operations).toContain("last_checked_at")
  })
})
