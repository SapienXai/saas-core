export function getPwaInstallScope(userId: string | null | undefined, workspaceId: string | null | undefined) { return userId && workspaceId ? `saas-core:pwa:${userId}:${workspaceId}` : null }
export function getPwaInstalledScopeKey(scope: string | null | undefined) { return scope ? `saas-core:pwa-installed:${scope}` : null }
export function getPwaInstallPromptPreferenceKey(userId: string | null | undefined, workspaceId: string | null | undefined) { return userId && workspaceId ? `saas-core:pwa-prompt-dismissed:${userId}:${workspaceId}` : null }
