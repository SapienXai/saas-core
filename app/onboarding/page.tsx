import { redirect } from "next/navigation"
import { getAccountState } from "@/lib/account-state"
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard"
export const dynamic = "force-dynamic"
export default async function OnboardingPage() { const state = await getAccountState(); if (!state.authenticated) redirect("/login?redirect=/onboarding"); if (state.path === "/app" && state.workspaceId) redirect("/app"); return <OnboardingWizard initialWorkspaceName="" /> }
