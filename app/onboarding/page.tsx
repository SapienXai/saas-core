import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
export const dynamic = "force-dynamic"
export default async function OnboardingPage() {
  const state = await getAccountState()
  if (!state.authenticated) redirect("/login?redirect=/onboarding")
  if (!state.workspaceId && (await getCurrentUserAccess())?.platformRole) redirect("/platform")
  if (state.workspaceId && state.path === "/app") redirect("/app")
  return <OnboardingWizard initialWorkspaceName="" mode="initial" />
}
