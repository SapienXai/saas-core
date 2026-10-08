import { getConfiguredAppDomain, getConfiguredRootDomain, getDevelopmentPlatformOrigin } from "@/lib/domains/hostname"

type PlatformUrlOptions = {
  nodeEnv?: string
  siteUrl?: string | null
  rootDomain?: string
  appDomain?: string
  requestHost?: string | null
}

function originFrom(value: string | null | undefined) {
  if (!value) return null
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

function getLocalOrigin(siteUrl?: string | null) {
  return originFrom(siteUrl) || "http://localhost:3000"
}

export function getApplicationOrigin(options: PlatformUrlOptions = {}) {
  if ((options.nodeEnv || process.env.NODE_ENV) !== "production") {
    return getDevelopmentPlatformOrigin("app", options.requestHost) || getLocalOrigin(options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL)
  }

  const appDomain = (options.appDomain || getConfiguredAppDomain()).replace(/^https?:\/\//, "").replace(/\/$/, "")
  return `https://${appDomain}`
}

export function getPlatformOrigin(options: PlatformUrlOptions = {}) {
  if ((options.nodeEnv || process.env.NODE_ENV) !== "production") {
    return getDevelopmentPlatformOrigin("root", options.requestHost) || getLocalOrigin(options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL)
  }

  const rootDomain = (options.rootDomain || getConfiguredRootDomain()).replace(/^https?:\/\//, "").replace(/\/$/, "")
  return `https://${rootDomain}`
}

export function getApplicationUrl(path = "/", options: PlatformUrlOptions = {}) {
  return new URL(path, `${getApplicationOrigin(options)}/`).toString()
}

/** Keep local billing returns on the browser's public site origin. */
export function getBillingReturnUrl(path = "/", options: PlatformUrlOptions = {}) {
  if ((options.nodeEnv || process.env.NODE_ENV) !== "production") {
    return new URL(path, `${getLocalOrigin(options.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL)}/`).toString()
  }

  return getApplicationUrl(path, options)
}

export function getApplicationLink(path = "/", options: PlatformUrlOptions = {}) {
  if ((options.nodeEnv || process.env.NODE_ENV) !== "production") return path
  return getApplicationUrl(path, options)
}

export function getPlatformUrl(path = "/", options: PlatformUrlOptions = {}) {
  return new URL(path, `${getPlatformOrigin(options)}/`).toString()
}
