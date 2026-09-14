import "server-only"

import type { UsageResolverMap } from "@/lib/entitlements"

/**
 * Product-owned, server-only usage resolvers.
 *
 * Core composes this map with its built-in workspace and member resolvers for
 * every server-side usage and Plan surface. Consumers may replace the empty
 * map with resolvers for their own resource keys without editing a
 * Core-managed file.
 */
export const PRODUCT_USAGE_RESOLVERS: UsageResolverMap = {}

export function getProductUsageResolvers(): UsageResolverMap {
  return PRODUCT_USAGE_RESOLVERS
}
