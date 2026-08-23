export type WorkspaceBranding = { appName: string; iconUrl?: string; themeColor: string; backgroundColor: string }

export function buildManifest(input: { workspaceId: string; branding: WorkspaceBranding; startUrl: string; scope: string }) {
  const revision = encodeURIComponent(`${input.workspaceId}:${input.branding.iconUrl ?? "default"}:${input.branding.themeColor}`)
  return { id: `/pwa/${input.workspaceId}`, name: input.branding.appName, short_name: input.branding.appName.slice(0, 12), start_url: `${input.startUrl}${input.startUrl.includes("?") ? "&" : "?"}pwa_revision=${revision}`, scope: input.scope, display: "standalone", theme_color: input.branding.themeColor, background_color: input.branding.backgroundColor, icons: input.branding.iconUrl ? [{ src: `${input.branding.iconUrl}${input.branding.iconUrl.includes("?") ? "&" : "?"}v=${revision}`, sizes: "192x192", type: "image/png" }] : [] }
}

export function buildServiceWorkerRegistration(input: { scriptUrl?: string; scope?: string } = {}) { return { scriptUrl: input.scriptUrl ?? "/sw.js", scope: input.scope ?? "/", cacheStrategy: "network-first", cacheVersion: "saas-core-pwa-v1" as const } }
