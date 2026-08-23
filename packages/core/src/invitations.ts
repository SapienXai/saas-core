import { createHash, randomBytes } from "node:crypto"
import { CoreError } from "./errors.js"
import { normalizeEmail } from "./normalize.js"
import type { Invitation, WorkspaceRole } from "./types.js"

export function createInvitationToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex")
}

export function createInvitationRecord(input: {
  id: string
  workspaceId: string
  email: string
  role: WorkspaceRole
  invitedBy: string
  expiresAt: string
  now?: string
}): { record: Invitation; token: string } {
  const token = createInvitationToken()
  return {
    token,
    record: {
      id: input.id,
      workspaceId: input.workspaceId,
      normalizedEmail: normalizeEmail(input.email),
      role: input.role,
      tokenHash: hashInvitationToken(token),
      status: "pending",
      invitedBy: input.invitedBy,
      expiresAt: input.expiresAt,
      emailDeliveryStatus: "pending",
      acceptedAt: null,
      revokedAt: null,
      createdAt: input.now ?? new Date().toISOString(),
    },
  }
}

export function validateInvitation(input: { invitation: Invitation; token: string; email: string; now?: Date }): void {
  const now = input.now ?? new Date()
  if (input.invitation.status !== "pending" || input.invitation.revokedAt || new Date(input.invitation.expiresAt) <= now || hashInvitationToken(input.token) !== input.invitation.tokenHash) {
    throw new CoreError("INVITATION_INVALID", "This invitation is no longer valid.")
  }
  if (normalizeEmail(input.email) !== input.invitation.normalizedEmail) throw new CoreError("INVITATION_INVALID", "Sign in with the invited email address.")
}
