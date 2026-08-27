import "server-only"

import { createServiceRoleClient } from "@/lib/supabase"

export async function audit(input: {
  actorUserId: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: Record<string, unknown>
  after?: Record<string, unknown>
  reason?: string | null
  metadata?: Record<string, unknown>
}) {
  const { error } = await createServiceRoleClient().from("platform_audit_logs").insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId || null,
    before_data: input.before || {},
    after_data: input.after || {},
    reason: input.reason || null,
    metadata: input.metadata || {},
  })
  if (error) throw new Error(`Audit log could not be written: ${error.message}`)
}
