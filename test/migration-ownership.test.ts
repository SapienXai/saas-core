import { describe, expect, it } from "vitest"
import { classifyMigrationLayout, classifyMigrationPath, isFlatMigrationPath, isProductOwnedPath } from "../packages/cli/bin/ownership.mjs"

describe("migration ownership", () => {
  const coreMigration = "supabase/migrations/20260917090000_example.sql"
  const corePaths = new Set([coreMigration])

  it("uses exact Core source identity instead of filename vocabulary", () => {
    expect(classifyMigrationPath(coreMigration, corePaths)).toBe("core")
    expect(classifyMigrationPath("supabase/migrations/20260918090000_create_venues.sql", corePaths)).toBe("product")
    expect(classifyMigrationPath("supabase/migrations/20260919090000_core_product_mix.sql", corePaths)).toBe("product")
    expect(isFlatMigrationPath("supabase/migrations/20260918090000_create_venues.sql")).toBe(true)
    expect(classifyMigrationLayout("supabase/migrations/20260918090000_create_venues.sql")).toBe("flat")
  })

  it("keeps legacy nested migrations Product-owned", () => {
    const legacy = "supabase/migrations/product/20260919000000_legacy.sql"
    expect(classifyMigrationPath(legacy, corePaths)).toBe("product")
    expect(isFlatMigrationPath(legacy)).toBe(false)
    expect(classifyMigrationLayout(legacy)).toBe("legacy-product")
    expect(isProductOwnedPath(legacy)).toBe(true)
  })

  it("treats unknown flat migrations as Product-owned only with consumer Core context", () => {
    expect(isProductOwnedPath("supabase/migrations/20260918090000_product.sql", [], corePaths)).toBe(true)
    expect(isProductOwnedPath(coreMigration, [], corePaths)).toBe(false)
  })

  it.each([
    "supabase/migrations/foo/20260919000000_unknown.sql",
    "supabase/migrations/foo/bar/20260919000000_unknown.sql",
    "supabase/migrations/archive/old.sql",
  ])("keeps arbitrary nested migration %s outside native flat ownership", (relative) => {
    expect(isFlatMigrationPath(relative)).toBe(false)
    expect(classifyMigrationLayout(relative)).toBe("noncanonical-nested")
    expect(classifyMigrationPath(relative, corePaths)).toBe("noncanonical-nested")
    expect(isProductOwnedPath(relative, [], corePaths)).toBe(false)
  })

  it("ignores non-SQL migration-directory files", () => {
    const relative = "supabase/migrations/README.md"
    expect(isFlatMigrationPath(relative)).toBe(false)
    expect(classifyMigrationLayout(relative)).toBeNull()
    expect(classifyMigrationPath(relative, corePaths)).toBeNull()
  })
})
