import type React from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Activity, ArrowLeft, Building2, Clock3, Mail, ShieldCheck } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { PlatformStatusButton } from "@/components/platform/platform-action-button"
import { PlatformPageHeader, PlatformSectionHeader, PlatformStatusBadge, PlatformSurface } from "@/components/platform/platform-primitives"
import { getPlatformUserDetail } from "@/lib/platform-admin"
import { canWritePlatform, requirePlatformRole } from "@/lib/platform-authorization"

export const dynamic = "force-dynamic"

export default async function PlatformUserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [{ role }, detail] = await Promise.all([requirePlatformRole(), getPlatformUserDetail(id)])
  if (!detail) notFound()
  const canWrite = canWritePlatform(role)
  const { user } = detail
  return (
    <div className="space-y-5">
      <Link href="/platform/users" className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-slate-500 hover:text-white"><ArrowLeft className="h-3.5 w-3.5" />Back to users</Link>
      <PlatformPageHeader eyebrow="Identity and access" title={user.name || user.email} description={user.name ? user.email : "Platform identity details and access state."} actions={<><PlatformStatusBadge status={user.status} /><PlatformStatusButton target="user" id={user.id} status={user.status} disabled={!canWrite} /></>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Summary icon={Mail} label="Email" value={user.email} />
        <Summary icon={Clock3} label="Last sign-in" value={user.lastSignInAt ? new Date(user.lastSignInAt).toLocaleDateString() : "Never"} />
        <Summary icon={Building2} label="Workspaces" value={detail.workspaces.length} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-5">
          <PlatformSurface className="p-4 sm:p-5">
            <PlatformSectionHeader title="Access profile" description="Effective platform and workspace access for this identity." icon={ShieldCheck} />
            <dl className="mt-4 space-y-3 text-sm">
              <DetailRow label="Platform role" value={user.platformRole?.replaceAll("_", " ") || "No platform role"} />
              <DetailRow label="Platform member state" value={user.platformMemberStatus || "Not assigned"} />
              <DetailRow label="Workspace role" value={user.workspaceRole || "No legacy profile role"} />
              <DetailRow label="Created" value={new Date(user.createdAt).toLocaleDateString()} />
              <DetailRow label="User ID" value={user.id} mono />
            </dl>
            {user.suspensionReason ? <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/[0.06] p-3"><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-rose-300">Suspension reason</p><p className="mt-1 text-sm text-slate-300">{user.suspensionReason}</p></div> : null}
          </PlatformSurface>
          <PlatformSurface className="p-4 sm:p-5">
            <PlatformSectionHeader title="Workspace access" description="Tenant memberships currently associated with this user." icon={Building2} />
            <div className="mt-4 space-y-2">{detail.workspaces.length ? detail.workspaces.map((membership) => membership.workspace ? <Link key={membership.id} href={`/platform/workspaces/${membership.workspace.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 hover:border-violet-400/30"><div className="min-w-0"><p className="truncate text-sm font-medium text-slate-200">{membership.workspace.name}</p><p className="truncate text-xs text-slate-500">{membership.workspace.slug}</p></div><Badge variant="outline" className="shrink-0 border-violet-400/25 text-violet-200">{membership.role}</Badge></Link> : null) : <p className="text-sm text-slate-500">No workspace memberships found.</p>}</div>
          </PlatformSurface>
        </div>
        <PlatformSurface className="p-4 sm:p-5">
          <PlatformSectionHeader title="Recent activity" description="Audited platform actions for this user." icon={Activity} />
          <div className="mt-4 space-y-3">{detail.audit.length ? detail.audit.map((entry) => <div key={entry.id} className="flex gap-3"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" /><div className="min-w-0"><p className="truncate text-sm text-slate-300">{entry.action}</p><p className="mt-0.5 truncate text-xs text-slate-500">{entry.reason || "No reason recorded"} · {new Date(entry.created_at).toLocaleDateString()}</p></div></div>) : <p className="text-sm text-slate-500">No user-specific platform activity yet.</p>}</div>
        </PlatformSurface>
      </div>
    </div>
  )
}

function Summary({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: React.ReactNode }) {
  return <div className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.04] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-slate-400"><Icon className="h-4 w-4" />{label}</div><p className="mt-3 truncate text-sm font-semibold text-white">{value}</p></div>
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex items-center justify-between gap-3"><dt className="shrink-0 text-slate-500">{label}</dt><dd className={`min-w-0 truncate text-right text-slate-200 ${mono ? "font-mono text-xs text-slate-500" : "capitalize"}`}>{value}</dd></div>
}
