"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { completeClaimForUser } from "@/lib/claimable-restaurants"

export async function completeClaimAction(restaurantId: string, token?: string | null) {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return { success: false as const, status: "authentication_required" as const }
  let result: Awaited<ReturnType<typeof completeClaimForUser>>
  try {
    result = await completeClaimForUser({ restaurantId, userId: data.user.id, token, auditAction: "restaurant.claimed" })
  } catch (claimError) {
    return { success: false as const, status: claimError instanceof Error ? claimError.message : "claim_failed" }
  }
  if (result.success) {
    revalidatePath(`/r/[slug]`, "page")
    revalidatePath("/manage")
    redirect("/manage")
  }
  return result
}
