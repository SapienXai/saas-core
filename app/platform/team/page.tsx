import { Badge } from "@/components/ui/badge"
import { PlatformMemberEditor } from "@/components/platform/platform-team-controls"
import { listPlatformMembers, listPlatformUsers } from "@/lib/platform-admin"
import { requirePlatformOwner } from "@/lib/platform-authorization"

export const dynamic = "force-dynamic"

export default async function PlatformTeamPage() {
  try {
    await requirePlatformOwner()
  } catch {
    return <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.06] p-6"><h2 className="text-lg font-semibold text-white">Platform team access is restricted</h2><p className="mt-2 text-sm text-slate-400">Only the platform owner can manage internal platform roles.</p></div>
  }
  const [members, users] = await Promise.all([listPlatformMembers(), listPlatformUsers()])
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-violet-300">Internal access</p><h2 className="mt-2 text-3xl font-bold text-white">Platform team</h2><p className="mt-2 text-sm text-slate-400">Manage the small set of staff who can access platform operations.</p></div><PlatformMemberEditor users={users.map((user) => ({ id: user.id, email: user.email, name: user.name }))} members={members} /><div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]"><div className="divide-y divide-white/10">{members.map((member) => <div key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="font-semibold text-white">{member.name || member.email}</p><p className="mt-1 text-xs text-slate-500">{member.email}</p></div><div className="flex items-center gap-2"><Badge variant="outline" className="border-violet-400/25 text-violet-200">{member.role}</Badge><Badge variant="outline" className={member.status === "active" ? "border-emerald-400/25 text-emerald-300" : "border-rose-400/25 text-rose-300"}>{member.status}</Badge></div></div>)}</div>{members.length === 0 && <p className="p-8 text-center text-sm text-slate-500">No platform staff have been added.</p>}</div></div>
}
