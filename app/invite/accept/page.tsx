import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { createServiceRoleClient } from "@/lib/supabase"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { INVITATION_INTENT_COOKIE } from "@/lib/invitations"
import { InvitationAcceptance } from "@/components/invitations/invitation-acceptance"

export const dynamic = "force-dynamic"

export default async function InvitationAcceptPage() {
  const cookieStore = await cookies()
  const tokenHash = cookieStore.get(INVITATION_INTENT_COOKIE)?.value
  if (!tokenHash) redirect("/login?error=invalid_invitation")
  const auth = await createSupabaseServerClient()
  const { data: userData } = await auth.auth.getUser()
  if (!userData.user) redirect("/login?redirect=/invite/accept")

  const { data: invitation } = await createServiceRoleClient()
    .from("workspace_invitations")
    .select("email, role, restaurant_access_mode, expires_at, workspaces(name)")
    .eq("token_hash", tokenHash)
    .maybeSingle()
  if (!invitation) redirect("/login?error=invalid_invitation")
  return <InvitationAcceptance invitation={invitation} userEmail={userData.user.email || ""} />
}

