import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { createServiceRoleClient } from "@/lib/supabase"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
import { getConfiguredRootDomain } from "@/lib/domains/hostname"

export const dynamic = "force-dynamic"

export default async function OnboardingPage({ searchParams }: { searchParams?: Promise<{ plan?: string; interval?: string }> }) {
  const state = await getAccountState()
  if (!state.authenticated) redirect("/login?redirect=/onboarding")
  if (state.path === "/manage") redirect("/manage")

  let restaurant = null
  if (state.restaurantId) {
    const { data } = await createServiceRoleClient().from("restaurants").select("*").eq("id", state.restaurantId).maybeSingle()
    restaurant = data
  }

  const intent = await searchParams
  const checkoutPlan = ["starter", "pro", "business"].includes(intent?.plan || "") ? intent?.plan || null : null
  const checkoutInterval = intent?.interval === "year" ? "year" : "month"
  return <OnboardingWizard initialRestaurant={restaurant} initialWorkspaceId={state.workspaceId} rootDomain={getConfiguredRootDomain()} checkoutPlan={checkoutPlan} checkoutInterval={checkoutInterval} exitHref="/manage" />
}
