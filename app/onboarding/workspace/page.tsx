import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { createServiceRoleClient } from "@/lib/supabase"
import { getWorkspaceEntitlements } from "@/lib/entitlements"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
import { WorkspaceCreationBlocked } from "@/components/onboarding/workspace-creation-blocked"
import { getConfiguredRootDomain } from "@/lib/domains/hostname"

export const dynamic = "force-dynamic"

export default async function NewWorkspacePage() {
  const state = await getAccountState()
  if (!state.authenticated) redirect("/login?redirect=/onboarding/workspace")

  const { data: existingWorkspace } = await createServiceRoleClient()
    .from("workspaces")
    .select("id, name")
    .eq("created_by", state.userId)
    .maybeSingle()

  if (existingWorkspace) {
    const entitlements = await getWorkspaceEntitlements(existingWorkspace.id).catch(() => null)
    return (
      <WorkspaceCreationBlocked
        currentPlan={entitlements?.planName || "Free"}
        currentWorkspaceName={existingWorkspace.name}
        ownedWorkspaceId={existingWorkspace.id}
      />
    )
  }

  return <OnboardingWizard initialRestaurant={null} initialWorkspaceId={null} rootDomain={getConfiguredRootDomain()} exitHref="/manage" />
}
