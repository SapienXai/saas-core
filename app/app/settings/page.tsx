import { CheckCircle2, Moon, ShieldCheck, UserRound } from "lucide-react"
import { getCurrentWorkspace } from "@/lib/authorization"
import { createServiceRoleClient } from "@/lib/supabase"
import { ManageListRow, ManagePage, ManagePageHeader, ManageSurface } from "@/components/manage/manage-responsive"

export const dynamic = "force-dynamic"

export default async function SettingsPage() {
  const membership = await getCurrentWorkspace(); const workspace = membership ? await createServiceRoleClient().from("workspaces").select("name, slug").eq("id", membership.workspace_id).maybeSingle() : null
  if (!membership || !workspace?.data) return <ManagePage><ManagePageHeader eyebrow="Workspace" title="Settings" description="No active workspace is available." /></ManagePage>
  return <ManagePage><ManagePageHeader eyebrow="Workspace" title="Settings" description={`${workspace.data.name} · workspace preferences.`} /><ManageSurface className="overflow-hidden"><div className="border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><p className="text-sm font-semibold text-slate-950 dark:text-white">Workspace identity</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">/{workspace.data.slug}</p></div><div className="divide-y divide-slate-100 dark:divide-white/10"><ManageListRow icon={UserRound} title="Account" subtitle="Manage sign-in and profile details." /><ManageListRow icon={Moon} title="Appearance" subtitle="Theme follows your saved management preference." /><ManageListRow icon={ShieldCheck} title="Access" subtitle={`Your workspace role is ${membership.role}.`} meta={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} /></div></ManageSurface></ManagePage>
}
