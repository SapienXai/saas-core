type PlanNavigationInput = {
  language?: string | null
  plan?: string | null
  hash?: string | null
  currentWorkspaceId?: string | null
  ownedWorkspaceId?: string | null
}

/**
 * Build a plan URL that first selects the user's own workspace when the
 * current management workspace is owned by somebody else.
 *
 * The manage layout consumes the workspace query parameter through the
 * existing authorized workspace-selection flow, then removes it from the
 * address bar before rendering the plan page.
 */
export function getPlanNavigationHref({
  language,
  plan,
  hash,
  currentWorkspaceId,
  ownedWorkspaceId,
}: PlanNavigationInput) {
  const params = new URLSearchParams()
  if (language) params.set("lang", language)
  if (plan) params.set("plan", plan)
  if (ownedWorkspaceId && ownedWorkspaceId !== currentWorkspaceId) params.set("workspace", ownedWorkspaceId)

  const query = params.toString()
  return `/manage/plan${query ? `?${query}` : ""}${hash || ""}`
}
