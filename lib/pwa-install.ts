export const PWA_INSTALL_PROMPT_MINIMIZED_KEY = "reservevia:manage:pwa-install-prompt:minimized"
export const PWA_INSTALLED_SCOPE_KEY = "reservevia:manage:pwa-installed"

export function getPwaInstallScope(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  restaurantId: string | null | undefined,
) {
  if (!userId) return null

  return `${userId}:${workspaceId || "account"}:${restaurantId || "all"}`
}

export function getPwaInstalledScopeKey(scope: string | null | undefined) {
  if (!scope) return null

  return `${PWA_INSTALLED_SCOPE_KEY}:${encodeURIComponent(scope)}`
}

export function getPwaInstallPromptPreferenceKey(
  userId: string | null | undefined,
  workspaceId: string | null | undefined,
  restaurantId?: string | null,
) {
  const scope = getPwaInstallScope(userId, workspaceId, restaurantId)
  if (!scope) return null

  return `${PWA_INSTALL_PROMPT_MINIMIZED_KEY}:${encodeURIComponent(scope)}`
}
