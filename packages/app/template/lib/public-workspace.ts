import "server-only"

import type { CoreHostResolution } from "@sapienx/saas-core"
import { classifyHostname, getRequestHostname, type HostnameKind } from "@/lib/domains/hostname"
import { resolveHost } from "@/lib/domains/domain-service"
import { isCanonicalAppPath, isCoreReservedPublicPath, normalizeRequestPathname } from "@/lib/route-ownership"

export type PublicWorkspaceHostnameKind = Extract<HostnameKind, "HOSTED_WORKSPACE" | "CUSTOM_WORKSPACE">

export type PublicWorkspaceContext = {
  workspaceId: string
  workspaceSlug: string
  workspaceName: string
  siteId: string
  productKey: string
  domainId: string
  hostname: string
  normalizedHostname: string
  domainType: CoreHostResolution["domainType"]
  isPrimary: boolean
  hostnameKind: PublicWorkspaceHostnameKind
  pathname: string
}

export type PublicWorkspaceResolution =
  | { status: "resolved"; context: PublicWorkspaceContext }
  | { status: "not_found" }
  | { status: "not_public_workspace" }
  | { status: "unavailable" }

function notFound(): PublicWorkspaceResolution {
  return { status: "not_found" }
}

function unavailable(): PublicWorkspaceResolution {
  return { status: "unavailable" }
}

function context(resolution: CoreHostResolution, hostnameKind: PublicWorkspaceHostnameKind, pathname: string): PublicWorkspaceResolution {
  if (!resolution.workspaceSlug || !resolution.workspaceName) return unavailable()
  return {
    status: "resolved",
    context: {
      workspaceId: resolution.workspaceId,
      workspaceSlug: resolution.workspaceSlug,
      workspaceName: resolution.workspaceName,
      siteId: resolution.siteId,
      productKey: resolution.productKey,
      domainId: resolution.domainId,
      hostname: resolution.hostname,
      normalizedHostname: resolution.normalizedHostname,
      domainType: resolution.domainType,
      isPrimary: resolution.isPrimary,
      hostnameKind,
      pathname,
    },
  }
}

export async function resolvePublicWorkspace(input: { hostname: string; pathname: string }): Promise<PublicWorkspaceResolution> {
  const pathname = normalizeRequestPathname(input.pathname)
  if (!pathname || isCanonicalAppPath(pathname) || isCoreReservedPublicPath(pathname)) return { status: "not_public_workspace" }

  const classification = classifyHostname(input.hostname)
  if ((classification.kind !== "HOSTED_WORKSPACE" && classification.kind !== "CUSTOM_WORKSPACE") || !classification.hostname) {
    return { status: "not_public_workspace" }
  }

  try {
    const resolution = await resolveHost(classification.hostname)
    return resolution ? context(resolution, classification.kind, pathname) : notFound()
  } catch {
    return unavailable()
  }
}

export async function resolvePublicWorkspaceRequest(request: Request): Promise<PublicWorkspaceResolution> {
  const hostname = getRequestHostname(request)
  if (!hostname) return { status: "not_public_workspace" }
  return resolvePublicWorkspace({ hostname, pathname: new URL(request.url).pathname })
}
