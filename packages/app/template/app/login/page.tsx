import { redirect } from "next/navigation"
import { LoginForm } from "@/components/auth/login-form"
import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"

export const dynamic = "force-dynamic"

export default async function LoginPage() {
  const state = await getAccountState()
  if (state.authenticated) {
    if (!state.workspaceId && (await getCurrentUserAccess())?.platformRole) redirect("/platform")
    redirect(state.path)
  }
  return <LoginForm />
}
