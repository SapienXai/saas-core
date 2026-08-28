import "server-only"

import { getRequestHostname, classifyHostname, type HostnameKind } from "@/lib/domains/hostname"
import { isCanonicalAppPath, isCoreReservedPublicPath, normalizeRequestPathname } from "@/lib/route-ownership"
import { createServiceRoleClient } from "@/lib/supabase"

export type PublicWorkspaceHostnameKind = Extract<HostnameKind, "HOSTED_WORKSPACE" | "CUSTOM_WORKSPACE">

export type PublicWorkspaceContext = {
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  hostname: string
  hostnameKind: PublicWorkspaceHostnameKind
  pathname: string
}

export type PublicWorkspaceResolution =
  | { status: "resolved"; context: PublicWorkspaceContext }
  | { status: "not_found" }
  | { status: "not_public_workspace" }
  | { status: "unavailable" }

type PublicWorkspaceRecord = {
  id: string
  name: string
  slug: string
  status: string
  platform_status: string
}

function notFound(): PublicWorkspaceResolution { return { status: "not_found" } }

function unavailable(): PublicWorkspaceResolution { return { status: "unavailable" } }

function isPublicWorkspace(workspace: Pick<PublicWorkspaceRecord, "status" | "platform_status">) {
  return workspace.status === "active" && workspace.platform_status === "active"
}

function context(workspace: PublicWorkspaceRecord, hostname: string, hostnameKind: PublicWorkspaceHostnameKind, pathname: string): PublicWorkspaceResolution {
  if (!isPublicWorkspace(workspace)) return notFound()
  return {
    status: "resolved",
    context: {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      workspaceName: workspace.name,
      hostname,
      hostnameKind,
      pathname,
    },
  }
}

async function resolveHostedWorkspace(hostname: string, workspaceSlug: string, pathname: string) {
  try {
    const { data, error } = await createServiceRoleClient()
      .from("workspaces")
      .select("id, name, slug, status, platform_status")
      .eq("slug", workspaceSlug)
      .eq("status", "active")
      .eq("platform_status", "active")
      .maybeSingle()
    if (error) return unavailable()
    if (!data) return notFound()
    return context(data as PublicWorkspaceRecord, hostname, "HOSTED_WORKSPACE", pathname)
  } catch {
    return unavailable()
  }
}

async function resolveCustomWorkspace(hostname: string, pathname: string) {
  try {
    const { data: domain, error: domainError } = await createServiceRoleClient()
      .from("workspace_domains")
      .select("workspace_id, status, provider_environment, verification_state, provider_verified, dns_configured, verified_at")
      .eq("hostname", hostname)
      .eq("status", "active")
      .eq("provider_environment", "production")
      .eq("verification_state", "verified")
      .eq("provider_verified", true)
      .eq("dns_configured", true)
      .not("verified_at", "is", null)
      .maybeSingle()
    if (domainError) return unavailable()
    if (!domain) return notFound()

    const { data: workspace, error: workspaceError } = await createServiceRoleClient()
      .from("workspaces")
      .select("id, name, slug, status, platform_status")
      .eq("id", domain.workspace_id)
      .eq("status", "active")
      .eq("platform_status", "active")
      .maybeSingle()
    if (workspaceError) return unavailable()
    if (!workspace) return notFound()
    return context(workspace as PublicWorkspaceRecord, hostname, "CUSTOM_WORKSPACE", pathname)
  } catch {
    return unavailable()
  }
}

export async function resolvePublicWorkspace(input: { hostname: string; pathname: string }): Promise<PublicWorkspaceResolution> {
  const pathname = normalizeRequestPathname(input.pathname)
  if (!pathname || isCanonicalAppPath(pathname) || isCoreReservedPublicPath(pathname)) return { status: "not_public_workspace" }

  const classification = classifyHostname(input.hostname)
  if (classification.kind === "HOSTED_WORKSPACE" && classification.workspaceSlug) {
    return resolveHostedWorkspace(classification.hostname || input.hostname, classification.workspaceSlug, pathname)
  }
  if (classification.kind === "CUSTOM_WORKSPACE" && classification.hostname) {
    return resolveCustomWorkspace(classification.hostname, pathname)
  }
  return { status: "not_public_workspace" }
}

export async function resolvePublicWorkspaceRequest(request: Request): Promise<PublicWorkspaceResolution> {
  const hostname = getRequestHostname(request)
  if (!hostname) return { status: "not_public_workspace" }
  return resolvePublicWorkspace({ hostname, pathname: new URL(request.url).pathname })
}
