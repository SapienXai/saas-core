import Link from "next/link"
import { ArrowRight, CheckCircle2, CircleAlert, Layers3, Settings2, Users, WalletCards } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getManagementContext } from "@/lib/management-context"
import { getWorkspaceUsage } from "@/lib/entitlements"
import { ManageEmptyState, ManageListRow, ManageMetricCard, ManageMetricGrid, ManagePage, ManagePageHeader, ManageSurface } from "@/components/manage/manage-responsive"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export const dynamic = "force-dynamic"

export default async function WorkspaceDashboard() {
  const context = await getManagementContext()
  if (!context) return <ManageEmptyState title="Sign in to continue" description="Your workspace management tools are available after authentication." />
  const workspace = context.currentWorkspace
  if (!workspace) return <ManagePage><ManagePageHeader eyebrow="Workspace" title="Create your first workspace" description="A workspace gives your team a secure place to build." actions={<Link href="/onboarding" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white transition hover:bg-violet-700">Create workspace <ArrowRight className="h-4 w-4" /></Link>} /><ManageSurface><ManageEmptyState title="Your workspace starts here" description="Set up the shared home for your team and product." /></ManageSurface></ManagePage>

  const usage = workspace.usage || await getWorkspaceUsage(workspace.id).catch(() => null)
  const name = workspace.workspace?.name || "Workspace"
  const ready = Boolean(workspace.workspace?.name && workspace.workspace?.slug)
  const showTeamManagement = PRODUCT_CONFIG.capabilities.workspaceTeamManagement !== false
  return <ManagePage>
    <ManagePageHeader eyebrow="Workspace overview" title={name} description="A focused cockpit for access, plan and setup." actions={<Badge className={`rounded-full px-3 py-1.5 ${ready ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200" : "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"}`}>{ready ? "Ready" : "Setup needed"}</Badge>} />
    <ManageMetricGrid>
      {showTeamManagement && <ManageMetricCard label="Team members" value={usage?.users ?? 0} detail="Manage access" icon={Users} href="/app/team" />}
      <ManageMetricCard label="Current plan" value={workspace.plan?.name || "Not configured"} detail="Plan & usage" icon={WalletCards} href="/app/plan" />
      <ManageMetricCard label="Workspace" value={ready ? "Ready" : "Needs setup"} detail="Core setup" icon={ready ? CheckCircle2 : CircleAlert} href="/app/setup" />
      <ManageMetricCard label="Settings" value="Open" detail="Workspace preferences" icon={Settings2} href="/app/settings" />
    </ManageMetricGrid>
    <ManageSurface className="overflow-hidden">
      <div className="border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Next actions</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Keep the workspace ready for daily operations.</p></div>
      <div className="divide-y divide-slate-100 dark:divide-white/10">
        {showTeamManagement && <ManageListRow icon={Users} href="/app/team" title="Invite your team" subtitle="Give the right people the right access." />}
        <ManageListRow icon={Layers3} href="/app/setup" title="Review workspace setup" subtitle="Check the foundation before adding your domain." />
        <ManageListRow icon={Settings2} href="/app/settings" title="Open workspace settings" subtitle="Keep identity and preferences current." />
      </div>
    </ManageSurface>
  </ManagePage>
}
