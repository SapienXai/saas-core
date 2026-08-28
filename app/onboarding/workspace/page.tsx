import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"

export const dynamic = "force-dynamic"

export default async function AdditionalWorkspacePage() {
  const state = await getAccountState()
  if (!state.authenticated) redirect("/login?redirect=/onboarding/workspace")
  if (!state.workspaceId) {
    if ((await getCurrentUserAccess())?.platformRole) redirect("/platform")
    redirect("/onboarding")
  }
  return <OnboardingWizard initialWorkspaceName="" mode="additional" />
}
