import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { AuthEntry } from "@/components/auth/auth-entry"

export const dynamic = "force-dynamic"

export default async function Home() {
  const state = await getAccountState()
  if (state.authenticated) {
    if (!state.workspaceId && (await getCurrentUserAccess())?.platformRole) redirect("/platform")
    redirect(state.path)
  }

  return <AuthEntry />
}
