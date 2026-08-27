import { defineSaaSCore } from "@sapienx/saas-core-config"
import type { Workspace } from "@sapienx/saas-core"

export const coreConfig = defineSaaSCore({
  version: "1.2.0",
  product: { key: "projects", name: "Projects" },
  auth: { provider: "supabase", requireEmailConfirmation: true },
  workspace: { slugSource: "user_input", defaultTimezone: "UTC" },
  permissions: { custom: { "projects:manage": ["owner", "admin", "manager"] } },
  billing: { enabled: true, provider: "paddle", environment: "sandbox" },
  entitlements: { features: ["projects:manage"], metrics: ["projects"] },
  usage: { enabled: true },
  notifications: { email: { name: "resend", enabled: false }, push: { name: "web-push", enabled: false } },
  domains: { enabled: false },
  pwa: { enabled: false },
  platform: { enabled: true, supportReadOnly: true },
})

export type Project = { id: string; workspaceId: Workspace["id"]; name: string; archivedAt: string | null }

export function createProject(input: { id: string; workspaceId: Workspace["id"]; name: string }): Project {
  return { ...input, archivedAt: null }
}
