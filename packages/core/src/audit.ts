import type { AuditEvent, Json } from "./types.js"

export function createAuditEvent(input: {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: Record<string, Json>
  after?: Record<string, Json>
  reason?: string | null
  metadata?: Record<string, Json>
  createdAt?: string
}): AuditEvent {
  return {
    id: input.id,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: input.before ?? {},
    after: input.after ?? {},
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
    createdAt: input.createdAt ?? new Date().toISOString(),
  }
}
