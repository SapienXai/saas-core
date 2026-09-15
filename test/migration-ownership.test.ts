import { describe, expect, it } from "vitest"
import { classifyMigrationPath, isFlatMigrationPath, isProductOwnedPath } from "../packages/cli/bin/ownership.mjs"

describe("migration ownership", () => {
  const coreMigration = "supabase/migrations/20260917090000_example.sql"
  const corePaths = new Set([coreMigration])

  it("uses exact Core source identity instead of filename vocabulary", () => {
    expect(classifyMigrationPath(coreMigration, corePaths)).toBe("core")
    expect(classifyMigrationPath("supabase/migrations/20260918090000_create_venues.sql", corePaths)).toBe("product")
    expect(classifyMigrationPath("supabase/migrations/20260919090000_core_product_mix.sql", corePaths)).toBe("product")
    expect(isFlatMigrationPath("supabase/migrations/20260918090000_create_venues.sql")).toBe(true)
  })

  it("keeps legacy nested migrations Product-owned", () => {
    const legacy = "supabase/migrations/product/20260919000000_legacy.sql"
    expect(classifyMigrationPath(legacy, corePaths)).toBe("product")
    expect(isProductOwnedPath(legacy)).toBe(true)
  })

  it("treats unknown flat migrations as Product-owned only with consumer Core context", () => {
    expect(isProductOwnedPath("supabase/migrations/20260918090000_product.sql", [], corePaths)).toBe(true)
    expect(isProductOwnedPath(coreMigration, [], corePaths)).toBe(false)
  })
})
