import "server-only"

/**
 * Product-owned details for the Core Platform workspace collection.
 *
 * Core owns the operator boundary and the collection shell. Products may add
 * safe, server-resolved domain summaries and child records without editing a
 * Core-managed route.
 */
export type ProductPlatformWorkspaceDetail = {
  summary: Array<{ label: string; value: string }>
  items?: Array<{ id: string; title: string; subtitle?: string | null; status?: string | null }>
  itemsLabel?: string
  emptyMessage?: string
}

export async function getProductPlatformWorkspaceDetails(workspaceIds: readonly string[]): Promise<Record<string, ProductPlatformWorkspaceDetail>> {
  if (!workspaceIds.length) return {}
  return {}
}
