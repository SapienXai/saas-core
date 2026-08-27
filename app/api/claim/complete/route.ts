import { NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { completeClaimForUser } from "@/lib/claimable-restaurants"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  let body: { restaurantId?: unknown; token?: unknown }
  try {
    body = await request.json() as { restaurantId?: unknown; token?: unknown }
  } catch {
    return NextResponse.json({ success: false, status: "invalid_request" }, { status: 400 })
  }

  const restaurantId = typeof body.restaurantId === "string" ? body.restaurantId : ""
  const token = typeof body.token === "string" ? body.token : null
  if (!restaurantId) return NextResponse.json({ success: false, status: "invalid_request" }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return NextResponse.json({ success: false, status: "authentication_required" }, { status: 401 })

  try {
    const result = await completeClaimForUser({ restaurantId, userId: data.user.id, token, auditAction: "restaurant.claimed" })
    if (result.success) {
      revalidatePath("/manage")
      revalidatePath("/r/[slug]", "page")
    }
    return NextResponse.json(result, { status: result.success ? 200 : 409 })
  } catch {
    return NextResponse.json({ success: false, status: "claim_failed" }, { status: 500 })
  }
}
