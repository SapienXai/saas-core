export const IGNORED_FILES = new Set([
  "next-env.d.ts",
  ".gitignore",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "consumer.gitignore",
])

// These paths are intentionally the CLI's ownership contract. Keep product
// code outside them so Core updates can remain conflict-aware and reversible.
export const PRODUCT_PREFIXES = [
  "src/product/",
  "app/(product)/",
  "app/product/",
  "components/product/",
  // Legacy compatibility only. New product migrations belong in the flat
  // Supabase-native directory and are classified by exact Core source/manifest
  // identity in the lifecycle CLI.
  "supabase/migrations/product/",
]

export const MIGRATION_PREFIX = "supabase/migrations/"
export const LEGACY_PRODUCT_MIGRATION_PREFIX = "supabase/migrations/product/"

export const PRODUCT_FILES = new Set([
  "lib/product-config.ts",
  "product.catalog.json",
  "styles/product-theme.css",
  "styles/product.css",
  "app/page.tsx",
  "app/manage/page.tsx",
  "supabase/config.toml",
  "supabase/seed.sql",
  "README.md",
  "AGENTS.md",
  ".env.example",
  // Supabase types include product tables after a consumer runs db:types.
  "types/supabase.ts",
])

export const DEFAULT_PRODUCT_OWNED_PATHS = [...PRODUCT_PREFIXES, ...PRODUCT_FILES]

export function isMigrationPath(relative) {
  return relative.startsWith(MIGRATION_PREFIX) && relative.endsWith(".sql")
}

export function isFlatMigrationPath(relative) {
  return isMigrationPath(relative) && !relative.startsWith(LEGACY_PRODUCT_MIGRATION_PREFIX)
}

export function isLegacyProductMigrationPath(relative) {
  return relative.startsWith(LEGACY_PRODUCT_MIGRATION_PREFIX) && relative.endsWith(".sql")
}

export function isCoreMigrationPath(relative, coreMigrationPaths = new Set()) {
  return isFlatMigrationPath(relative) && coreMigrationPaths.has(relative)
}

export function classifyMigrationPath(relative, coreMigrationPaths = new Set()) {
  if (!isMigrationPath(relative)) return null
  if (isLegacyProductMigrationPath(relative)) return "product"
  return isCoreMigrationPath(relative, coreMigrationPaths) ? "core" : "product"
}

/**
 * @param {string} relative
 * @param {string[]} [productOwnedPaths]
 * @param {Set<string> | null} [coreMigrationPaths]
 */
export function isProductOwnedPath(relative, productOwnedPaths = DEFAULT_PRODUCT_OWNED_PATHS, coreMigrationPaths = null) {
  if (isFlatMigrationPath(relative)) return coreMigrationPaths instanceof Set ? !coreMigrationPaths.has(relative) : false
  return relative.startsWith("public/product-") || productOwnedPaths.some((ownedPath) => ownedPath.endsWith("/") ? relative.startsWith(ownedPath) : relative === ownedPath)
}

export function isIgnoredPath(relative) {
  return IGNORED_FILES.has(relative)
    || relative === ".saas-core-manifest.json"
    || relative === "supabase/.gitignore"
    || relative.startsWith(".playwright-cli/")
    || relative.startsWith(".next/")
    || relative.startsWith("node_modules/")
    || relative.startsWith(".turbo/")
    || relative.startsWith("coverage/")
    || relative.startsWith("playwright-report/")
    || relative.startsWith("test-results/")
    || relative.startsWith("output/")
    || relative.startsWith("artifacts/")
    || relative.startsWith("supabase/.branches/")
    || relative.startsWith("supabase/.temp/")
}
