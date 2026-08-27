import { NextResponse } from "next/server"
import { getCurrentWorkspace } from "@/lib/authorization"
import { can } from "@/lib/entitlements"
import { isWebPushConfigured } from "@/lib/push-service"
import { createServiceRoleClient } from "@/lib/supabase"

export async function GET() {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return NextResponse.json({ eligible: false, configured: false, subscription: false }, { status: 401 })

  const eligible = await can(workspace.workspace_id, "pushNotifications")
  if (!eligible) return NextResponse.json({ eligible: false, configured: false, subscription: false })

  const { data } = await createServiceRoleClient()
    .from("workspace_push_subscriptions")
    .select("id")
    .eq("workspace_id", workspace.workspace_id)
    .eq("user_id", workspace.user_id)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    eligible: true,
    configured: isWebPushConfigured(),
    subscription: Boolean(data),
  }, { headers: { "Cache-Control": "private, no-store, max-age=0" } })
}
