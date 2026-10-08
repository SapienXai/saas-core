import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { isProductCapabilityEnabled, PRODUCT_CONFIG } from "@/lib/product-config"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"

export const dynamic = "force-dynamic"

export default async function AdditionalWorkspacePage() {
  const state = await getAccountState()
  if (!state.authenticated) redirect("/login?redirect=/onboarding/workspace")
  const access = await getCurrentUserAccess()
  if (!isProductCapabilityEnabled("workspaceManagement", access?.platformRole)) redirect(PRODUCT_CONFIG.shell?.homePath || "/manage")
  if (!state.workspaceId) {
    if (access?.platformRole) redirect("/platform")
    redirect("/onboarding")
  }
  return <OnboardingWizard initialWorkspaceName="" mode="additional" />
}
