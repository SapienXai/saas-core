import { NextResponse } from "next/server"
import { getCurrentWorkspace } from "@/lib/authorization"
import { can } from "@/lib/entitlements"
import { getWebPushPublicKey, isWebPushConfigured } from "@/lib/push-service"

export async function GET() {
  const workspace = await getCurrentWorkspace()
  if (!workspace || !(await can(workspace.workspace_id, "pushNotifications"))) {
    return NextResponse.json({ ok: false, eligible: false, error: "Push notifications are not included in the current plan." }, { status: 403 })
  }

  const publicKey = getWebPushPublicKey()

  if (!publicKey || !isWebPushConfigured()) {
    return NextResponse.json({ ok: false, eligible: true, error: "Web Push is not configured" }, { status: 503 })
  }

  return NextResponse.json({ ok: true, eligible: true, publicKey })
}
