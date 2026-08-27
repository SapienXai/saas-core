import { NextResponse, type NextRequest } from "next/server"
import { getCurrentWorkspace } from "@/lib/authorization"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { can } from "@/lib/entitlements"
import { createServiceRoleClient } from "@/lib/supabase"

type PushSubscriptionBody = {
  endpoint?: string
  keys?: {
    p256dh?: string
    auth?: string
  }
}

function isValidSubscription(value: unknown): value is PushSubscriptionBody {
  if (!value || typeof value !== "object") return false
  const subscription = value as PushSubscriptionBody
  return Boolean(
    typeof subscription.endpoint === "string" && subscription.endpoint.length >= 20 && subscription.endpoint.length <= 4096 &&
      typeof subscription.keys?.p256dh === "string" && subscription.keys.p256dh.length >= 16 &&
      typeof subscription.keys?.auth === "string" && subscription.keys.auth.length >= 8,
  )
}

async function getEligibleWorkspace() {
  const workspace = await getCurrentWorkspace()
  if (!workspace) return { workspace: null, error: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }) }
  if (!(await can(workspace.workspace_id, "pushNotifications"))) {
    return { workspace: null, error: NextResponse.json({ ok: false, error: "Push notifications are not included in the current plan." }, { status: 403 }) }
  }
  return { workspace, error: null }
}

function hasSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin")
  return !origin || origin === new URL(request.url).origin
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ ok: false, error: "Invalid request origin" }, { status: 403 })
  const { workspace, error } = await getEligibleWorkspace()
  if (error || !workspace) return error

  const body = await request.json().catch(() => null)
  if (!isValidSubscription(body)) {
    return NextResponse.json({ ok: false, error: "Invalid subscription" }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  const { error: upsertError } = await supabase
    .from("workspace_push_subscriptions")
    .upsert({
      workspace_id: workspace.workspace_id,
      user_id: workspace.user_id,
      endpoint: body.endpoint,
      p256dh: body.keys!.p256dh,
      auth: body.keys!.auth,
      user_agent: request.headers.get("user-agent"),
      platform: request.headers.get("sec-ch-ua-platform"),
      status: "active",
      last_seen_at: new Date().toISOString(),
      revoked_at: null,
    }, { onConflict: "workspace_id,user_id,endpoint" })

  if (upsertError) {
    console.error("Failed to save workspace push subscription:", { workspaceId: workspace.workspace_id, userId: workspace.user_id, error: upsertError.message })
    return NextResponse.json({ ok: false, error: "Failed to save subscription" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ ok: false, error: "Invalid request origin" }, { status: 403 })
  const access = await getCurrentUserAccess()
  if (!access) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => null)
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : null
  if (endpoint && endpoint.length > 4096) {
    return NextResponse.json({ ok: false, error: "Missing endpoint" }, { status: 400 })
  }

  const supabase = createServiceRoleClient()
  let query = supabase
    .from("workspace_push_subscriptions")
    .update({ status: "revoked", revoked_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
    .eq("user_id", access.userId)
  if (endpoint) {
    const workspace = await getCurrentWorkspace()
    if (!workspace) return NextResponse.json({ ok: false, error: "Workspace access is required" }, { status: 403 })
    query = query.eq("workspace_id", workspace.workspace_id).eq("endpoint", endpoint)
  }

  const { error } = await query

  if (error) {
    console.error("Failed to disable workspace push subscription:", { userId: access.userId, error: error.message })
    return NextResponse.json({ ok: false, error: "Failed to disable subscription" }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
