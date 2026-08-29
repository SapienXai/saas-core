import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { getProductOnboardingPath, PRODUCT_CONFIG } from "../lib/product-config"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

describe("Core deferred Workspace onboarding contract", () => {
  it("selects the product setup handoff only when the product opts in", () => {
    const page = readFileSync(path.join(root, "app/onboarding/page.tsx"), "utf8")
    expect(page).toContain("isDeferredWorkspaceProvisioning")
    expect(page).toContain("redirect(getProductOnboardingPath())")
    expect(readFileSync(path.join(root, "lib/workspace-bootstrap.ts"), "utf8")).toContain('rpc("ensure_initial_workspace"')
    expect(readFileSync(path.join(root, "lib/workspace-bootstrap.ts"), "utf8")).not.toMatch(/venue|playlist|track|placedj/i)
  })

  it("falls back when a product handoff is not a safe internal path", () => {
    const original = PRODUCT_CONFIG.onboarding
    PRODUCT_CONFIG.onboarding = { productSetupPath: "https://example.test" }
    expect(getProductOnboardingPath()).toBe("/app")
    PRODUCT_CONFIG.onboarding = original
  })

  it("keeps the generic database boundary free of product resources", () => {
    const migration = readFileSync(path.join(root, "supabase/migrations/20260829150000_saas_core_deferred_workspace_onboarding.sql"), "utf8")
    expect(migration).toContain("ensure_initial_workspace")
    expect(migration).toContain("WORKSPACE_LIMIT_REACHED")
    expect(migration).toContain("pg_advisory_xact_lock")
    expect(migration).not.toMatch(/venue|playlist|track|placedj/i)
  })
})
