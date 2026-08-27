import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { getTrustedPlatformOrigin } from "@/lib/domains/hostname"

export const INVITATION_INTENT_COOKIE = "reservevia_invitation_intent"
export const INVITATION_EXPIRY_DAYS = 7
export const INVITATION_RESEND_COOLDOWN_SECONDS = 60

export function createInvitationToken() {
  return randomBytes(32).toString("base64url")
}

export function hashInvitationToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function isInvitationToken(value: string | null | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9_-]{32,128}$/.test(value))
}

export function getInvitationAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Fall through to the trusted configured app host.
    }
  }
  return getTrustedPlatformOrigin("app")
}

export function getInvitationUrl(token: string) {
  return `${getInvitationAppUrl()}/invite/accept/start?token=${encodeURIComponent(token)}`
}
