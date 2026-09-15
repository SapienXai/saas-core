export const IGNORED_FILES = new Set([
  "next-env.d.ts",
  ".gitignore",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
])

// These paths are intentionally the CLI's ownership contract. Keep product
// code outside them so Core updates can remain conflict-aware and reversible.
export const PRODUCT_PREFIXES = [
  "src/product/",
  "app/(product)/",
  "app/product/",
  "components/product/",
  "supabase/migrations/product/",
]

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

export function isProductOwnedPath(relative, productOwnedPaths = DEFAULT_PRODUCT_OWNED_PATHS) {
  return relative.startsWith("public/product-") || productOwnedPaths.some((ownedPath) => ownedPath.endsWith("/") ? relative.startsWith(ownedPath) : relative === ownedPath)
}

export function isIgnoredPath(relative) {
  return IGNORED_FILES.has(relative)
    || relative === ".saas-core-manifest.json"
    || relative === "supabase/.gitignore"
    || relative.startsWith(".next/")
    || relative.startsWith("node_modules/")
    || relative.startsWith("output/")
    || relative.startsWith("artifacts/")
    || relative.startsWith("supabase/.branches/")
    || relative.startsWith("supabase/.temp/")
}
