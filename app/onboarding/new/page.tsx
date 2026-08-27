import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
import { getConfiguredRootDomain } from "@/lib/domains/hostname"
import { getManagementContext } from "@/lib/management-context"

export const dynamic = "force-dynamic"

export default async function NewRestaurantOnboardingPage() {
  const state = await getAccountState()
  if (!state.authenticated) redirect("/login?redirect=/onboarding/new")
  if (!state.workspaceId || !state.onboardingComplete) redirect("/onboarding")
  const context = await getManagementContext()
  if (!context?.currentWorkspace?.id) redirect("/manage")
  return <OnboardingWizard initialRestaurant={null} initialWorkspaceId={state.workspaceId} rootDomain={getConfiguredRootDomain()} mode="additional" exitHref="/manage" />
}
