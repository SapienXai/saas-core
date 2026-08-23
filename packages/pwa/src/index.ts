export type WorkspaceBranding = { appName: string; iconUrl?: string; themeColor: string; backgroundColor: string }

export function buildManifest(input: { workspaceId: string; branding: WorkspaceBranding; startUrl: string; scope: string }) {
  return { id: `/pwa/${input.workspaceId}`, name: input.branding.appName, short_name: input.branding.appName.slice(0, 12), start_url: input.startUrl, scope: input.scope, display: "standalone", theme_color: input.branding.themeColor, background_color: input.branding.backgroundColor, icons: input.branding.iconUrl ? [{ src: input.branding.iconUrl, sizes: "192x192", type: "image/png" }] : [] }
}
